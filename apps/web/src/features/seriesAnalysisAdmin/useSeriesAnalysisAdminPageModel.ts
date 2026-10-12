import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { runIdempotentMutation } from "@/shared/api/idempotency";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import {
  requestAllSeriesAnalysisRecalculation,
  requestSeriesAnalysisRecalculation,
} from "@/shared/api/seriesAnalysis";
import type { SeriesAnalysisRecalculationAccepted } from "@/shared/api/seriesAnalysis";
import { seriesAnalysisAdminOverviewQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { useAuthorization } from "@/shared/auth/useAuthorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

type AcceptanceMessage = { detail: string; title: string };
type RecalculationTarget =
  | { kind: "all" }
  | { kind: "title"; gameTitleId: string; gameTitleName: string };
type RecalculationRequest = { target: RecalculationTarget; lease: AuthorizationLease };

/**
 * Owns the route selection, server resource lifecycle, and recalculation commands for the page.
 * The returned contract contains display-ready sections rather than TanStack Query results.
 */
export function useSeriesAnalysisAdminPageModel() {
  const queryClient = useQueryClient();
  const authorization = useAuthorization();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const gameTitleId = searchParams.get("gameTitleId")?.trim() || undefined;
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
  const overviewOptions = seriesAnalysisAdminOverviewQueryOptions(gameTitleId);
  const canReadOverview = authorization.canRead("operations", overviewOptions.queryKey);
  const overviewQuery = useQuery({
    ...overviewOptions,
    enabled: () => canReadOverview && authorization.canRead("operations", overviewOptions.queryKey),
  });
  const sourceOverview = authorization.retained.operations ? overviewQuery.data : undefined;
  const canonicalGameTitleId = sourceOverview?.selectedTitle?.gameTitleId;
  const canonicalOverviewQuery = useQuery({
    ...seriesAnalysisAdminOverviewQueryOptions(canonicalGameTitleId, false),
    placeholderData: () => undefined,
  });
  // The default-title alias can outlive a manual refresh of the canonical query.
  // Keep its older history from flashing on screen or overwriting that newer cache.
  const hasNewerCanonical =
    !gameTitleId &&
    canonicalGameTitleId &&
    canonicalOverviewQuery.dataUpdatedAt > overviewQuery.dataUpdatedAt;
  const overview = authorization.retained.operations
    ? hasNewerCanonical
      ? canonicalOverviewQuery.data
      : sourceOverview
    : undefined;

  useEffect(() => {
    if (
      canReadOverview &&
      !gameTitleId &&
      canonicalGameTitleId &&
      sourceOverview &&
      !overviewQuery.isPlaceholderData
    ) {
      const key = seriesAnalysisAdminOverviewQueryOptions(canonicalGameTitleId).queryKey;
      if ((queryClient.getQueryState(key)?.dataUpdatedAt ?? 0) < overviewQuery.dataUpdatedAt) {
        queryClient.setQueryData(key, sourceOverview, { updatedAt: overviewQuery.dataUpdatedAt });
      }
      const next = new URLSearchParams(searchParams);
      next.set("gameTitleId", canonicalGameTitleId);
      setSearchParams(next, { replace: true });
    }
  }, [
    canReadOverview,
    canonicalGameTitleId,
    gameTitleId,
    sourceOverview,
    overviewQuery.dataUpdatedAt,
    overviewQuery.isPlaceholderData,
    queryClient,
    searchParams,
    setSearchParams,
  ]);

  const recalculation = useMutation({
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

  // A 202 received while auth is being checked remains a receipt, not another POST.
  // Only the still-authorized owner reconciles its reads when access resumes.
  useEffect(() => {
    const response = recalculation.data;
    const request = recalculation.variables;
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
  }, [authorization, queryClient, recalculation.data, recalculation.variables]);

  const target = recalculation.variables?.target;
  const currentRequest = recalculation.variables
    ? authorization.isCurrent(recalculation.variables.lease)
    : false;
  const recalculationPending = currentRequest && recalculation.isPending;
  const response = currentRequest ? recalculation.data : undefined;
  const acceptanceMessage: AcceptanceMessage | undefined =
    response && target
      ? target.kind === "all"
        ? {
            detail: "作品ごとの処理として順番に実行します。",
            title: `${response.targetCount}作品の再計算を受け付けました`,
          }
        : {
            detail: "受付後の状態は、この画面の実行状況と処理履歴へ反映されます。",
            title:
              response.target?.requestDisposition === "forced_run_reserved"
                ? `${target.gameTitleName}は現在の計算後に再計算します`
                : `${target.gameTitleName}の再計算を受け付けました`,
          }
      : undefined;

  const selectedGameTitleId = gameTitleId ?? canonicalGameTitleId;
  const selectedTitleCandidate = overview?.selectedTitle;
  const selectedTitle =
    selectedTitleCandidate && selectedTitleCandidate.gameTitleId === selectedGameTitleId
      ? selectedTitleCandidate
      : null;
  const mutationError =
    !currentRequest || (target?.kind === "title" && target.gameTitleId !== selectedGameTitleId)
      ? null
      : recalculation.error;

  const resourceErrorTitle = useRetryNotice(
    shouldShowQueryError(overviewQuery)
      ? normalizeDisplayApiError(overviewQuery.error).title
      : undefined,
    overviewQuery.isFetching,
    gameTitleId ?? "",
  );
  const resourceErrorDetail = useRetryNotice(
    shouldShowQueryError(overviewQuery)
      ? normalizeDisplayApiError(overviewQuery.error).detail
      : undefined,
    overviewQuery.isFetching,
    gameTitleId ?? "",
  );

  return {
    authorization: {
      canOperate: authorization.allowed.operations,
      retainOperations: authorization.retained.operations,
      canRecalculateAll: authorization.allowed.admin,
      retainAdmin: authorization.retained.admin,
      adminEpoch: authorization.epoch.admin,
    },
    actions: {
      clearRecalculationFeedback: () => {
        if (!hasPendingCommand()) recalculation.reset();
      },
      recalculateAll: async () => {
        if (hasPendingCommand() || !overview?.titleOptions.length) return;
        const lease = authorization.begin("admin");
        if (!lease) return;
        activeCommand.current = lease;
        await recalculation.mutateAsync({ target: { kind: "all" }, lease });
      },
      recalculateTitle: () => {
        if (hasPendingCommand() || !selectedTitle || selectedTitle.pendingManualRun) return;
        const lease = authorization.begin("operations");
        if (!lease) return;
        activeCommand.current = lease;
        recalculation.mutate({
          lease,
          target: {
            kind: "title",
            gameTitleId: selectedTitle.gameTitleId,
            gameTitleName: selectedTitle.gameTitleName,
          },
        });
      },
      refresh: () => {
        if (authorization.begin("operations")) void overviewQuery.refetch();
      },
      selectTitle: (value: string) => {
        if (!authorization.begin("operations")) return;
        if (!hasPendingCommand()) recalculation.reset();
        const next = new URLSearchParams(searchParams);
        if (value) next.set("gameTitleId", value);
        else next.delete("gameTitleId");
        setSearchParams(next, { replace: true });
      },
    },
    feedback: {
      acceptance: acceptanceMessage,
      mutationError: mutationError
        ? normalizeDisplayApiError(mutationError, "再計算を受け付けられません")
        : undefined,
      resourceError: resourceErrorTitle
        ? { title: resourceErrorTitle, detail: resourceErrorDetail }
        : undefined,
    },
    recalculation: {
      pending: recalculationPending,
      allPending: recalculationPending && target?.kind === "all",
      titlePending: recalculationPending && target?.kind === "title",
      titlePendingLabel:
        target?.kind === "title" ? `${target.gameTitleName}を受け付け中` : "受け付け中",
      titleUnavailable: !selectedTitle,
      titleReserved: Boolean(selectedTitle?.pendingManualRun),
    },
    resource: {
      data: overview,
      loading:
        (authorization.auth.isChecking || isInitialQueryLoading(overviewQuery)) &&
        !resourceErrorTitle,
      refreshing: overviewQuery.isFetching && !recalculationPending,
      // Switching from the default query cancels its in-flight request.
      refreshDisabled:
        !authorization.allowed.operations ||
        overviewQuery.isFetching ||
        recalculationPending ||
        (!gameTitleId && canonicalGameTitleId !== undefined),
    },
    selection: {
      gameTitleId: selectedGameTitleId,
      options:
        overview?.titleOptions.map((title) => ({
          label: `${title.gameTitleName} (${title.confirmedMatchCount}戦)`,
          value: title.gameTitleId,
        })) ?? [],
      selectedTitle,
    },
  };
}
