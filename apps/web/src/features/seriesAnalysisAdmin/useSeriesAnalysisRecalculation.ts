import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { recalculationTargetForTitle } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminModel";
import type {
  AnalysisAdminTitle,
  RecalculationTarget,
} from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminModel";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import {
  requestAllSeriesAnalysisRecalculation,
  requestSeriesAnalysisRecalculation,
} from "@/shared/api/seriesAnalysis";
import type { SeriesAnalysisRecalculationAccepted } from "@/shared/api/seriesAnalysis";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import type { useAuthorization } from "@/shared/auth/useAuthorization";

type RecalculationRequest = { target: RecalculationTarget; lease: AuthorizationLease };

export function useSeriesAnalysisRecalculation(authorization: ReturnType<typeof useAuthorization>) {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const activeCommand = useRef<AuthorizationLease | undefined>(undefined);
  const hasPendingCommand = () =>
    Boolean(activeCommand.current && authorization.isCurrent(activeCommand.current));
  const mounted = useRef(false);
  const handledAcceptance = useRef<SeriesAnalysisRecalculationAccepted | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const mutation = useMutation({
    mutationFn: ({ target, lease }: RecalculationRequest) => {
      if (!mounted.current || !authorization.canCommit(lease))
        throw new DOMException("権限を確認できません", "AbortError");
      return target.kind === "title"
        ? runIdempotentMutation(
            idempotencyKeys,
            "seriesAnalysis.recalculateTitle",
            { gameTitleId: target.gameTitleId },
            (options) => requestSeriesAnalysisRecalculation(target.gameTitleId, options),
          )
        : runIdempotentMutation(
            idempotencyKeys,
            "seriesAnalysis.recalculateAll",
            { confirmation: "all_titles" },
            requestAllSeriesAnalysisRecalculation,
          );
    },
    onError: (error, { lease }) => {
      if (mounted.current) authorization.reportError(error, lease);
    },
    onSettled: (_data, _error, { lease }) => {
      if (activeCommand.current === lease) activeCommand.current = undefined;
    },
  });
  // A 202 received during an auth check remains a receipt; only its authorized owner reconciles it.
  useEffect(() => {
    const response = mutation.data;
    const request = mutation.variables;
    if (
      !response ||
      !request ||
      handledAcceptance.current === response ||
      !authorization.canCommit(request.lease)
    )
      return;
    handledAcceptance.current = response;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.adminRoot() }),
      queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.statusRoot() }),
    ]);
  }, [authorization, mutation.data, mutation.variables, queryClient]);
  const current = mutation.variables ? authorization.isCurrent(mutation.variables.lease) : false;
  return {
    target: mutation.variables?.target,
    response: current ? mutation.data : undefined,
    error: current ? mutation.error : null,
    pending: current && mutation.isPending,
    clearFeedback: () => {
      if (!hasPendingCommand()) mutation.reset();
    },
    recalculateAll: async (titleCount: number) => {
      if (hasPendingCommand() || !titleCount) return;
      const lease = authorization.begin("admin");
      if (!lease) return;
      activeCommand.current = lease;
      await mutation.mutateAsync({ target: { kind: "all" }, lease });
    },
    recalculateTitle: (title: AnalysisAdminTitle | null) => {
      const target = recalculationTargetForTitle(title);
      if (hasPendingCommand() || !target) return;
      const lease = authorization.begin("operations");
      if (!lease) return;
      activeCommand.current = lease;
      mutation.mutate({ target, lease });
    },
  };
}
