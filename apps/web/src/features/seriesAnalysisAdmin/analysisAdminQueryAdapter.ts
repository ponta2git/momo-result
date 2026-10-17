import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import type { RecalculationTarget } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminPresentation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisKeys, seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import {
  requestAllSeriesAnalysisRecalculation,
  requestSeriesAnalysisRecalculation,
} from "@/shared/api/seriesAnalysis";
import type {
  SeriesAnalysisAdminOverview,
  SeriesAnalysisRecalculationAccepted,
} from "@/shared/api/seriesAnalysis";
import { seriesAnalysisAdminOverviewQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import type { AuthorizationAccess, AuthorizationLease } from "@/shared/auth/authorization";
import { canReadProtectedQuery } from "@/shared/auth/authorizationQueryAdapter";

type RecalculationRequest = { target: RecalculationTarget; lease: AuthorizationLease };

/** Resolves the default alias without overwriting a newer canonical overview. */
export function useAnalysisAdminOverviewRead(
  gameTitleId: string | undefined,
  authorization: Pick<AuthorizationAccess, "can" | "retained">,
): {
  data: SeriesAnalysisAdminOverview | undefined;
  selectedTitleId: string | undefined;
  defaultTitleId: string | undefined;
  resolvingDefaultTitle: boolean;
  loading: boolean;
  fetching: boolean;
  error: unknown;
  refresh: () => Promise<void>;
  refreshRadar: () => void;
} {
  const queryClient = useQueryClient();
  const options = seriesAnalysisAdminOverviewQueryOptions(gameTitleId);
  const canRead = canReadProtectedQuery(authorization, queryClient, "operations", options.queryKey);
  const query = useQuery({
    ...options,
    enabled: () =>
      canRead && canReadProtectedQuery(authorization, queryClient, "operations", options.queryKey),
  });
  const source = authorization.retained.operations ? query.data : undefined;
  const canonicalTitleId = source?.selectedTitle?.gameTitleId;
  const canonicalQuery = useQuery({
    ...seriesAnalysisAdminOverviewQueryOptions(canonicalTitleId, false),
    placeholderData: () => undefined,
  });
  const hasNewerCanonical =
    !gameTitleId && canonicalTitleId && canonicalQuery.dataUpdatedAt > query.dataUpdatedAt;
  const data = authorization.retained.operations
    ? hasNewerCanonical
      ? canonicalQuery.data
      : source
    : undefined;
  const defaultTitleId =
    canRead && !gameTitleId && !query.isPlaceholderData ? canonicalTitleId : undefined;
  useEffect(() => {
    if (!defaultTitleId || !source) return;
    const key = seriesAnalysisAdminOverviewQueryOptions(defaultTitleId).queryKey;
    // Check again at commit so a refresh that settled after render still wins.
    if ((queryClient.getQueryState(key)?.dataUpdatedAt ?? 0) < query.dataUpdatedAt) {
      queryClient.setQueryData(key, source, { updatedAt: query.dataUpdatedAt });
    }
  }, [defaultTitleId, source, query.dataUpdatedAt, queryClient]);
  const selectedTitleId = gameTitleId ?? canonicalTitleId;
  const refreshRadar = () => {
    if (selectedTitleId)
      void queryClient.invalidateQueries({
        queryKey: seriesPlayerRadarKeys.state(selectedTitleId),
        exact: true,
      });
  };
  return {
    data,
    selectedTitleId,
    defaultTitleId,
    resolvingDefaultTitle: !gameTitleId && canonicalTitleId !== undefined,
    loading: isInitialQueryLoading(query),
    fetching: query.isFetching,
    error: shouldShowQueryError(query) ? query.error : undefined,
    refresh: async () => {
      await Promise.all([
        query.refetch(),
        selectedTitleId
          ? queryClient.invalidateQueries({
              queryKey: seriesPlayerRadarKeys.state(selectedTitleId),
              exact: true,
            })
          : undefined,
      ]);
    },
    refreshRadar,
  };
}

/** Supplies accepted recalculation receipts; the owner decides when they may be adopted. */
export function useAnalysisRecalculationSubmission({
  canSubmit,
  onFailure,
  onFinish,
}: {
  canSubmit: (request: RecalculationRequest) => boolean;
  onFailure: (error: unknown, request: RecalculationRequest) => void;
  onFinish: (request: RecalculationRequest) => void;
}): {
  submitted: RecalculationRequest | undefined;
  accepted: SeriesAnalysisRecalculationAccepted | undefined;
  error: unknown;
  pending: boolean;
  submit: (request: RecalculationRequest) => void;
  submitAndWait: (request: RecalculationRequest) => Promise<SeriesAnalysisRecalculationAccepted>;
  clear: () => void;
  reconcileAcceptance: () => void;
} {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const mutation = useMutation({
    mutationFn: (request: RecalculationRequest) => {
      if (!canSubmit(request)) throw new DOMException("権限を確認できません", "AbortError");
      const { target } = request;
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
    onError: onFailure,
    onSettled: (_data, _error, request) => onFinish(request),
  });
  const reconcileAcceptance = useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.adminRoot() }),
      queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.statusRoot() }),
    ]);
  }, [queryClient]);
  return {
    submitted: mutation.variables,
    accepted: mutation.data,
    error: mutation.error,
    pending: mutation.isPending,
    submit: mutation.mutate,
    submitAndWait: mutation.mutateAsync,
    clear: mutation.reset,
    reconcileAcceptance,
  };
}
