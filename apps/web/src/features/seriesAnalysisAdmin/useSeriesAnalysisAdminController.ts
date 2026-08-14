import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { runIdempotentMutation } from "@/shared/api/idempotency";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import {
  requestAllSeriesAnalysisRecalculation,
  requestSeriesAnalysisRecalculation,
} from "@/shared/api/seriesAnalysis";
import { seriesAnalysisAdminOverviewQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

type AcceptanceMessage = { detail: string; title: string };

export function useSeriesAnalysisAdminController() {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const gameTitleId = searchParams.get("gameTitleId")?.trim() || undefined;
  const [acceptanceMessage, setAcceptanceMessage] = useState<AcceptanceMessage | undefined>();
  const overviewQuery = useQuery(seriesAnalysisAdminOverviewQueryOptions(gameTitleId));

  useEffect(() => {
    if (!gameTitleId && overviewQuery.data?.selectedTitle?.gameTitleId) {
      const next = new URLSearchParams(searchParams);
      next.set("gameTitleId", overviewQuery.data.selectedTitle.gameTitleId);
      setSearchParams(next, { replace: true });
    }
  }, [gameTitleId, overviewQuery.data?.selectedTitle?.gameTitleId, searchParams, setSearchParams]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.adminRoot() }),
      queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.statusRoot() }),
    ]);
  };

  const titleMutation = useMutation({
    mutationFn: (targetGameTitleId: string) =>
      runIdempotentMutation(
        idempotencyKeys,
        "seriesAnalysis.recalculateTitle",
        { gameTitleId: targetGameTitleId },
        (options) => requestSeriesAnalysisRecalculation(targetGameTitleId, options),
      ),
    onMutate: () => setAcceptanceMessage(undefined),
    onSuccess: async (response) => {
      await invalidate();
      setAcceptanceMessage({
        detail: "受付後の状態は、この画面の実行状況と処理履歴へ反映されます。",
        title:
          response.target?.requestDisposition === "forced_run_reserved"
            ? "現在の計算後に再計算します"
            : "再計算を受け付けました",
      });
    },
  });

  const allMutation = useMutation({
    mutationFn: () =>
      runIdempotentMutation(
        idempotencyKeys,
        "seriesAnalysis.recalculateAll",
        { confirmation: "all_titles" },
        requestAllSeriesAnalysisRecalculation,
      ),
    onMutate: () => setAcceptanceMessage(undefined),
    onSuccess: async (response) => {
      await invalidate();
      setAcceptanceMessage({
        detail: "作品ごとの処理として順番に実行します。",
        title: `${response.targetCount}作品の再計算を受け付けました`,
      });
    },
  });

  const mutationError = titleMutation.error ?? allMutation.error;
  return {
    acceptanceMessage,
    actions: {
      recalculateAll: () => allMutation.mutateAsync(),
      recalculateTitle: () => {
        const targetGameTitleId = gameTitleId ?? overviewQuery.data?.selectedTitle?.gameTitleId;
        if (!targetGameTitleId) return Promise.resolve(undefined);
        return titleMutation.mutateAsync(targetGameTitleId);
      },
      refresh: () => void overviewQuery.refetch(),
      selectTitle: (value: string) => {
        setAcceptanceMessage(undefined);
        const next = new URLSearchParams(searchParams);
        if (value) next.set("gameTitleId", value);
        else next.delete("gameTitleId");
        setSearchParams(next, { replace: true });
      },
    },
    data: overviewQuery.data,
    error: overviewQuery.isError ? normalizeDisplayApiError(overviewQuery.error) : undefined,
    gameTitleId,
    loading: overviewQuery.isPending,
    mutationError: mutationError
      ? normalizeDisplayApiError(mutationError, "再計算を受け付けられません")
      : undefined,
    pendingAll: allMutation.isPending,
    pendingTitle: titleMutation.isPending,
    refreshing: overviewQuery.isFetching,
  };
}
