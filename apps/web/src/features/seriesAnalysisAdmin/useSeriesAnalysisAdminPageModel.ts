import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { runIdempotentMutation } from "@/shared/api/idempotency";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import {
  requestAllSeriesAnalysisRecalculation,
  requestSeriesAnalysisRecalculation,
} from "@/shared/api/seriesAnalysis";
import { seriesAnalysisAdminOverviewQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

type AcceptanceMessage = { detail: string; title: string };
type RecalculationTarget =
  | { kind: "all" }
  | { kind: "title"; gameTitleId: string; gameTitleName: string };

/**
 * Owns the route selection, server resource lifecycle, and recalculation commands for the page.
 * The returned contract contains display-ready sections rather than TanStack Query results.
 */
export function useSeriesAnalysisAdminPageModel() {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const gameTitleId = searchParams.get("gameTitleId")?.trim() || undefined;
  const [acceptanceMessage, setAcceptanceMessage] = useState<AcceptanceMessage | undefined>();
  const commandPending = useRef(false);
  const overviewQuery = useQuery(seriesAnalysisAdminOverviewQueryOptions(gameTitleId));
  const sourceOverview = overviewQuery.data;
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
  const overview = hasNewerCanonical ? canonicalOverviewQuery.data : sourceOverview;

  useEffect(() => {
    if (
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
    canonicalGameTitleId,
    gameTitleId,
    sourceOverview,
    overviewQuery.dataUpdatedAt,
    overviewQuery.isPlaceholderData,
    queryClient,
    searchParams,
    setSearchParams,
  ]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.adminRoot() }),
      queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.statusRoot() }),
    ]);
  };

  const recalculation = useMutation({
    mutationFn: (target: RecalculationTarget) =>
      target.kind === "title"
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
          ),
    onMutate: () => setAcceptanceMessage(undefined),
    onSuccess: async (response, target) => {
      setAcceptanceMessage(
        target.kind === "all"
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
            },
      );
      await invalidate();
    },
    onSettled: () => {
      commandPending.current = false;
    },
  });

  const selectedGameTitleId = gameTitleId ?? canonicalGameTitleId;
  const selectedTitleCandidate = overview?.selectedTitle;
  const selectedTitle =
    selectedTitleCandidate && selectedTitleCandidate.gameTitleId === selectedGameTitleId
      ? selectedTitleCandidate
      : null;
  const mutationError =
    recalculation.variables?.kind === "title" &&
    recalculation.variables.gameTitleId !== selectedGameTitleId
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
    actions: {
      recalculateAll: async () => {
        if (commandPending.current || !overview?.titleOptions.length) return;
        commandPending.current = true;
        await recalculation.mutateAsync({ kind: "all" });
      },
      recalculateTitle: () => {
        if (commandPending.current || !selectedTitle || selectedTitle.pendingManualRun) return;
        commandPending.current = true;
        recalculation.mutate({
          kind: "title",
          gameTitleId: selectedTitle.gameTitleId,
          gameTitleName: selectedTitle.gameTitleName,
        });
      },
      refresh: () => void overviewQuery.refetch(),
      selectTitle: (value: string) => {
        setAcceptanceMessage(undefined);
        if (!commandPending.current) recalculation.reset();
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
      pending: recalculation.isPending,
      allPending: recalculation.isPending && recalculation.variables.kind === "all",
      titlePending: recalculation.isPending && recalculation.variables.kind === "title",
      titlePendingLabel:
        recalculation.variables?.kind === "title"
          ? `${recalculation.variables.gameTitleName}を受け付け中`
          : "受け付け中",
      titleUnavailable: !selectedTitle,
      titleReserved: Boolean(selectedTitle?.pendingManualRun),
    },
    resource: {
      data: overview,
      loading: isInitialQueryLoading(overviewQuery) && !resourceErrorTitle,
      refreshing: overviewQuery.isFetching && !recalculation.isPending,
      refreshDisabled: overviewQuery.isFetching || recalculation.isPending,
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
