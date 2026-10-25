import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  achievementCatalogQueryOptions,
  invalidateAchievementReads,
} from "@/shared/api/achievementQueryOptions";
import { addMatchAchievements } from "@/shared/api/achievements";
import type { AchievementItem, AddMatchAchievementsRequest } from "@/shared/api/achievements";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { matchIdentityReadQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { showToast } from "@/shared/ui/feedback/Toast";

export type AchievementRecordProps = {
  item: AchievementItem;
  memberId: string;
  existingClaim: boolean;
  onClose: () => void;
};

export function useAchievementRecord({
  item,
  memberId,
  existingClaim,
  onClose,
}: AchievementRecordProps) {
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKeyStore();
  const [matchId, setMatchId] = useState("");
  const [itemVersion, setItemVersion] = useState(item.version);
  const [confirmClose, setConfirmClose] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const identity = useQuery(matchIdentityReadQueryOptions(matchId || undefined));
  const matchIdentity = identity.data?.kind === "found" ? identity.data.value : undefined;
  const eligible = Boolean(
    matchIdentity &&
    matchIdentity.gameTitleId === item.gameTitleId &&
    (item.common || item.mapMasterIds.includes(matchIdentity.mapMasterId)),
  );
  const unavailable = item.ruleKind !== "manual" || Boolean(item.retiredAt) || existingClaim;
  const mutation = useMutation({
    mutationFn: (input: { matchId: string; request: AddMatchAchievementsRequest }) =>
      runIdempotentMutation(idempotency, "achievements.addMatch", input, (options) =>
        addMatchAchievements(input.matchId, input.request, options),
      ),
    onSuccess: () => {
      void invalidateAchievementReads(queryClient, item.gameTitleId);
      showToast({ title: "達成を記録しました", tone: "success" });
      onClose();
    },
  });
  const conflict =
    item.version !== itemVersion ||
    (mutation.isError && normalizeUnknownApiError(mutation.error).status === 409);
  const busy = mutation.isPending || refreshing;
  const canSave =
    eligible && !unavailable && !conflict && !identity.isFetching && !identity.isError && !busy;
  const submit = async () => {
    if (!canSave || !matchIdentity) return;
    await mutation.mutateAsync({
      matchId,
      request: {
        expectedMatchVersion: matchIdentity.version,
        achievements: [
          {
            achievementId: item.achievementId,
            memberId,
            expectedItemVersion: itemVersion,
            expectedClaimVersion: null,
          },
        ],
      },
    });
  };
  const reload = async () => {
    setRefreshing(true);
    setReloadFailed(false);
    try {
      const [catalog, selected] = await Promise.all([
        queryClient.fetchQuery({
          ...achievementCatalogQueryOptions(item.gameTitleId),
          staleTime: 0,
        }),
        identity.refetch(),
      ]);
      const current = catalog.items.find((value) => value.achievementId === item.achievementId);
      if (!current || selected.isError) {
        setReloadFailed(true);
        return;
      }
      setItemVersion(current.version);
      mutation.reset();
    } catch {
      setReloadFailed(true);
    } finally {
      setRefreshing(false);
    }
  };
  const requestClose = () => {
    if (mutation.isPending || refreshing) return;
    if (matchId) setConfirmClose(true);
    else onClose();
  };
  return {
    matchId,
    selectMatch: (value: string) => {
      if (!busy) setMatchId(value);
    },
    confirmClose,
    dismissCloseConfirmation: () => setConfirmClose(false),
    refreshing,
    reloadFailed,
    matchIdentity,
    matchMissing: identity.data?.kind === "notFound",
    matchLoading: identity.isFetching,
    matchFailed: identity.isError,
    retryMatch: () => void identity.refetch(),
    eligible,
    unavailable,
    busy,
    saving: mutation.isPending,
    saveError: mutation.isError ? normalizeUnknownApiError(mutation.error).detail : undefined,
    conflict,
    canSave,
    submit,
    reload,
    requestClose,
  };
}
