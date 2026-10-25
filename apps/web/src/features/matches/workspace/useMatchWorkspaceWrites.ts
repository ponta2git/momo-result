import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { invalidateAchievementReads } from "@/shared/api/achievementQueryOptions";
import { addMatchAchievements } from "@/shared/api/achievements";
import {
  invalidateAfterDraftCancelled,
  invalidateAfterMatchConfirmed,
  invalidateAfterMatchUpdated,
} from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { cancelMatchDraft } from "@/shared/api/matchDrafts";
import { confirmMatch, updateMatch } from "@/shared/api/matches";
import type { ConfirmMatchRequest, UpdateMatchRequest } from "@/shared/api/matches";
import { evictDraftSourceImageBlobs } from "@/shared/api/sourceImageQueries";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { assertDefined } from "@/shared/lib/invariant";

type WriteKind = "confirm" | "update" | "cancelDraft";
type SavedWrite =
  | { kind: "confirm" | "update"; matchId: string; achievementOnly?: boolean }
  | { kind: "cancelDraft" };
type FailedWrite =
  | { kind: "confirm"; error: unknown; draftId: string | undefined }
  | { kind: "update" | "cancelDraft"; error: unknown };

type WriteEvents = {
  started: (kind: WriteKind) => void;
  saved: (result: SavedWrite) => void;
  failed: (failure: FailedWrite) => void | Promise<void>;
};

/** Reconciles confirmed writes before notifying the workflow, and awaits failure recovery. */
export function useMatchWorkspaceWrites(events: WriteEvents): {
  cancelDraft: (draftId: string) => Promise<void>;
  cancelDraftPending: boolean;
  confirm: (request: ConfirmMatchRequest) => Promise<void>;
  pending: boolean;
  update: (
    matchId: string | undefined,
    request: UpdateMatchRequest,
    achievementOnly?: boolean,
  ) => void;
} {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const confirm = useMutation({
    onMutate: () => events.started("confirm"),
    mutationFn: (request: ConfirmMatchRequest) =>
      runIdempotentMutation(idempotencyKeys, "matchWorkspace.confirmMatch", request, (options) =>
        confirmMatch(request, options),
      ),
    onSuccess: async (response, request) => {
      if (request.matchDraftId) evictDraftSourceImageBlobs(queryClient, request.matchDraftId);
      await invalidateAfterMatchConfirmed(queryClient);
      events.saved({ kind: "confirm", matchId: response.matchId });
    },
    onError: (error, request) =>
      events.failed({ kind: "confirm", error, draftId: request.matchDraftId }),
  });
  const update = useMutation({
    onMutate: () => events.started("update"),
    mutationFn: ({
      matchId,
      request,
      achievementOnly,
    }: {
      matchId: string | undefined;
      request: UpdateMatchRequest;
      achievementOnly: boolean;
    }) => {
      assertDefined(matchId, "matchId");
      if (achievementOnly) {
        const additional = {
          expectedMatchVersion: request.expectedVersion,
          achievements: request.achievements ?? [],
        };
        return runIdempotentMutation(
          idempotencyKeys,
          "matchWorkspace.addAchievements",
          { matchId, request: additional },
          async (options) => {
            await addMatchAchievements(matchId, additional, options);
            return { matchId };
          },
        );
      }
      return runIdempotentMutation(
        idempotencyKeys,
        "matchWorkspace.updateMatch",
        { matchId, request },
        (options) => updateMatch(matchId, request, options),
      );
    },
    onSuccess: async (response, { matchId, request, achievementOnly }) => {
      assertDefined(matchId, "matchId");
      if (achievementOnly) await invalidateAchievementReads(queryClient, request.gameTitleId);
      else await invalidateAfterMatchUpdated(queryClient, matchId);
      events.saved({ kind: "update", matchId: response.matchId, achievementOnly });
    },
    onError: (error) => events.failed({ kind: "update", error }),
  });
  const cancel = useMutation({
    onMutate: () => events.started("cancelDraft"),
    mutationFn: (draftId: string) =>
      runIdempotentMutation(
        idempotencyKeys,
        "matchWorkspace.cancelMatchDraft",
        { draftId },
        (options) => cancelMatchDraft(draftId, options),
      ),
    onSuccess: async (_, draftId) => {
      evictDraftSourceImageBlobs(queryClient, draftId);
      await invalidateAfterDraftCancelled(queryClient);
      events.saved({ kind: "cancelDraft" });
    },
    onError: (error) => events.failed({ kind: "cancelDraft", error }),
  });
  const { mutateAsync: confirmRequest } = confirm;
  const { mutateAsync: cancelRequest } = cancel;
  const { mutate: updateRequest } = update;
  const confirmMatchRequest = useCallback(
    async (request: ConfirmMatchRequest) => {
      await confirmRequest(request);
    },
    [confirmRequest],
  );
  const cancelDraft = useCallback(
    async (draftId: string) => {
      await cancelRequest(draftId);
    },
    [cancelRequest],
  );
  const updateMatchRequest = useCallback(
    (matchId: string | undefined, request: UpdateMatchRequest, achievementOnly = false) => {
      updateRequest({ matchId, request, achievementOnly });
    },
    [updateRequest],
  );

  return {
    cancelDraft,
    cancelDraftPending: cancel.isPending,
    confirm: confirmMatchRequest,
    pending: confirm.isPending || update.isPending || cancel.isPending,
    update: updateMatchRequest,
  };
}
