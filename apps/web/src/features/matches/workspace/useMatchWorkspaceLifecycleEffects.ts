import { useEffect } from "react";
import type { Dispatch } from "react";

import { confirmedDraftMessages } from "@/features/matches/confirmedDraftNavigation";
import type { MatchFormAction } from "@/features/matches/workspace/matchFormReducer";
import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import {
  heldEventPatchById,
  latestHeldEventPatch,
} from "@/features/matches/workspace/workspaceViewModel";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";

export function useMatchWorkspaceLifecycleEffects({
  dispatch,
  draftDetail,
  hasHandoff,
  heldEventId,
  heldEvents,
  isInitialized,
  mode,
  preferredHeldEventId,
  preferredHeldEventPending,
  redirectConfirmedDraft,
  useSampleDrafts,
}: {
  dispatch: Dispatch<MatchFormAction>;
  draftDetail: MatchDraftDetailResponse | undefined;
  hasHandoff: boolean;
  heldEventId: string;
  heldEvents: HeldEventResponse[];
  isInitialized: boolean;
  mode: WorkspaceMode;
  preferredHeldEventId: string | undefined;
  preferredHeldEventPending: boolean;
  redirectConfirmedDraft: (
    detail: MatchDraftDetailResponse | undefined,
    message: string,
  ) => boolean;
  useSampleDrafts: boolean;
}) {
  useEffect(() => {
    if (mode === "edit" || useSampleDrafts) {
      return;
    }
    redirectConfirmedDraft(draftDetail, confirmedDraftMessages.loadRedirect);
  }, [draftDetail, mode, redirectConfirmedDraft, useSampleDrafts]);

  useEffect(() => {
    if (
      !isInitialized ||
      hasHandoff ||
      mode === "edit" ||
      heldEventId ||
      heldEvents.length === 0 ||
      preferredHeldEventPending
    ) {
      return;
    }
    const patch =
      heldEventPatchById(heldEvents, preferredHeldEventId) ?? latestHeldEventPatch(heldEvents);
    if (!patch) {
      return;
    }
    dispatch({
      patch,
      type: "patch_root",
    });
  }, [
    dispatch,
    hasHandoff,
    heldEventId,
    heldEvents,
    isInitialized,
    mode,
    preferredHeldEventId,
    preferredHeldEventPending,
  ]);
}
