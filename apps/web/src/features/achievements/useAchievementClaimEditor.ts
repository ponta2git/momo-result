import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  achievementDateTimeFromInput,
  achievementDateTimeInput,
} from "@/shared/achievements/achievementDates";
import { achievementKeys, invalidateAchievementReads } from "@/shared/api/achievementQueryOptions";
import { correctAchievementClaim } from "@/shared/api/achievements";
import type {
  AchievementCatalog,
  AchievementClaim,
  AchievementItem,
  CorrectAchievementClaimRequest,
} from "@/shared/api/achievements";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { matchIdentityReadQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { showToast } from "@/shared/ui/feedback/Toast";

export type AchievementClaimEditorProps = {
  claim: AchievementClaim;
  item: AchievementItem;
  onClose: () => void;
};

function claimForm(claim: AchievementClaim) {
  return {
    state: claim.state,
    matchId: claim.matchId ?? "",
    date: achievementDateTimeInput(claim.achievedAt),
  };
}

export function useAchievementClaimEditor({ claim, item, onClose }: AchievementClaimEditorProps) {
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKeyStore();
  const [baseline, setBaseline] = useState({ claim, itemVersion: item.version });
  const [form, setForm] = useState(() => claimForm(claim));
  const [confirmation, setConfirmation] = useState<"close" | "reload" | "cancel" | null>(null);
  const [validation, setValidation] = useState("");
  const identity = useQuery(matchIdentityReadQueryOptions(form.matchId || undefined));
  const matchIdentity = identity.data?.kind === "found" ? identity.data.value : undefined;
  const dirty = JSON.stringify(form) !== JSON.stringify(claimForm(baseline.claim));
  const conflict =
    claim.version !== baseline.claim.version || item.version !== baseline.itemVersion;
  const automatic = item.ruleKind !== "manual";
  const confirmationRequired = form.state === "unconfirmed";
  const cancelling = form.state === "cancelled";
  const eligibleIdentity =
    cancelling ||
    !form.matchId ||
    Boolean(
      matchIdentity &&
      matchIdentity.gameTitleId === item.gameTitleId &&
      (item.common || item.mapMasterIds.includes(matchIdentity.mapMasterId)),
    );
  const mutation = useMutation({
    mutationFn: (request: CorrectAchievementClaimRequest) =>
      runIdempotentMutation(
        idempotency,
        "achievements.correctClaim",
        { claimId: claim.claimId, request },
        (options) => correctAchievementClaim(claim.claimId, request, options),
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData<AchievementCatalog>(
        achievementKeys.catalog(item.gameTitleId),
        (current) =>
          current
            ? {
                ...current,
                claims: current.claims.map((value) =>
                  value.claimId === saved.claimId ? saved : value,
                ),
              }
            : current,
      );
      void invalidateAchievementReads(queryClient, item.gameTitleId);
      showToast({ title: "実績の記録を保存しました", tone: "success" });
      onClose();
    },
    onError: (error) => {
      if (normalizeUnknownApiError(error).status === 409)
        void queryClient.invalidateQueries({ queryKey: achievementKeys.catalog(item.gameTitleId) });
    },
  });
  const canSave =
    dirty &&
    !conflict &&
    !automatic &&
    !confirmationRequired &&
    !mutation.isPending &&
    eligibleIdentity &&
    (cancelling ||
      !form.matchId ||
      Boolean(matchIdentity && !identity.isFetching && !identity.isError));
  const submit = async () => {
    if (!canSave) return;
    const originalDate = achievementDateTimeInput(baseline.claim.achievedAt);
    const achievedAt = cancelling
      ? (baseline.claim.achievedAt ?? null)
      : form.matchId
        ? (matchIdentity?.playedAt ?? null)
        : form.date === originalDate
          ? (baseline.claim.achievedAt ?? null)
          : achievementDateTimeFromInput(form.date);
    if (!cancelling && form.date && !form.matchId && !achievedAt) {
      setValidation("達成日時を正しく入力してください。");
      return;
    }
    setValidation("");
    await mutation.mutateAsync({
      expectedVersion: baseline.claim.version,
      expectedItemVersion: baseline.itemVersion,
      state: form.state,
      matchId: cancelling ? null : form.matchId || null,
      achievedAt,
      expectedMatchVersion: !cancelling && form.matchId ? (matchIdentity?.version ?? null) : null,
    });
  };
  const requestClose = () => {
    if (mutation.isPending) return;
    if (dirty) setConfirmation("close");
    else onClose();
  };
  const reload = () => {
    setBaseline({ claim, itemVersion: item.version });
    setForm(claimForm(claim));
    mutation.reset();
  };
  const requestSave = async () => {
    if (!canSave) return;
    if (cancelling && baseline.claim.state !== "cancelled") setConfirmation("cancel");
    else await submit();
  };
  const confirmAction = async () => {
    if (confirmation === "cancel") await submit();
    else if (confirmation === "reload") reload();
    else if (confirmation === "close") onClose();
    setConfirmation(null);
  };
  return {
    form,
    changeState: (state: string) => setForm((current) => ({ ...current, state })),
    selectMatch: (matchId: string) => setForm((current) => ({ ...current, matchId })),
    changeDate: (date: string) => setForm((current) => ({ ...current, date })),
    canLeaveUnconfirmed: baseline.claim.state === "unconfirmed",
    dateLocked: Boolean(baseline.claim.matchId),
    confirmation,
    dismissConfirmation: () => setConfirmation(null),
    confirmAction,
    requestReload: () => setConfirmation("reload"),
    validation,
    matchIdentity,
    matchMissing: identity.data?.kind === "notFound",
    matchLoading: identity.isLoading,
    matchFailed: identity.isError,
    retryMatch: () => void identity.refetch(),
    dirty,
    conflict,
    automatic,
    confirmationRequired,
    eligibleIdentity,
    saving: mutation.isPending,
    saveError: mutation.isError ? normalizeUnknownApiError(mutation.error).detail : undefined,
    canSave,
    requestSave,
    requestClose,
  };
}
