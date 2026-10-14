import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";

import type { RadarEditingModel } from "@/features/seriesAnalysisAdmin/radarThresholdEditorModel";
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { seriesAnalysisScopeStatusQueryOptions } from "@/shared/api/seriesPlayerRadar";
import { playerRadarAggregateDisplay } from "@/shared/seriesAnalysis/playerRadarDisplay";

/** Reads saved scope metrics only. Input changes never participate in these query keys. */
export function useRadarEditingEvaluation({
  active,
  gameTitleId,
  currentBasisId,
  scope,
  prepared,
}: {
  active: boolean;
  gameTitleId: string;
  currentBasisId: string | null;
  scope: { seasonMasterId: string; mapMasterId: string };
  prepared: RadarEditingModel["evaluation"];
}) {
  const queryClient = useQueryClient();
  const usePublished = active && !prepared;
  const statusQuery = useQuery({
    ...seriesAnalysisStatusQueryOptions(gameTitleId),
    enabled: usePublished,
  });
  const artifact = statusQuery.data?.currentArtifact;
  const query =
    usePublished && artifact
      ? {
          gameTitleId,
          artifactId: artifact.artifactId,
          seasonMasterId: scope.seasonMasterId || undefined,
          mapMasterId: scope.mapMasterId || undefined,
        }
      : undefined;
  const queryIdentity = query ? JSON.stringify(query) : undefined;
  const refreshIdentity = useRef(queryIdentity);
  useLayoutEffect(() => {
    refreshIdentity.current = queryIdentity;
    return () => {
      refreshIdentity.current = undefined;
    };
  }, [queryIdentity, refreshIdentity]);
  const scopeQuery = useQuery(seriesAnalysisScopeStatusQueryOptions(query));
  const aggregateQuery = useQuery({
    ...seriesAnalysisAggregateQueryOptions(
      scopeQuery.data?.state === "available" ? query : undefined,
    ),
    // A different scope must never briefly show the previous scope's scores.
    placeholderData: () => undefined,
  });
  const aggregate = aggregateQuery.data;
  const matchingBasis = (aggregate?.playerRadar.basis?.basisId ?? null) === currentBasisId;
  const matchingScope =
    aggregate &&
    query &&
    aggregate.artifact.artifactId === query.artifactId &&
    ("seasonMasterId" in aggregate.scope ? aggregate.scope.seasonMasterId : "") ===
      scope.seasonMasterId &&
    ("mapMasterId" in aggregate.scope ? aggregate.scope.mapMasterId : "") === scope.mapMasterId;
  const valid =
    usePublished && matchingScope && matchingBasis && scopeQuery.data?.state === "available";
  const display = valid ? playerRadarAggregateDisplay(aggregate) : null;
  const evaluation: RadarEditingModel["evaluation"] = active
    ? (prepared ??
      (display && aggregate
        ? {
            key: `${aggregate.artifact.artifactId}:${scope.seasonMasterId}:${scope.mapMasterId}`,
            before: display,
            raw: display,
            createdAt: aggregate.artifact.publishedAt,
          }
        : null))
    : null;
  const loading =
    usePublished && (statusQuery.isFetching || scopeQuery.isFetching || aggregateQuery.isFetching);
  const error =
    usePublished && (statusQuery.isError || scopeQuery.isError || aggregateQuery.isError);
  const message =
    evaluation || !active
      ? null
      : loading
        ? "比較に使う保存済みの成績を読み込み中です。"
        : error
          ? "比較を読み込めません。入力を保持したまま基準の状態を更新してください。"
          : scopeQuery.data?.state === "empty"
            ? "この比較条件に対象試合はありません。入力はそのまま保存できます。"
            : aggregate && !matchingBasis
              ? "分析結果と適用中の基準が異なります。最新の分析結果を読み込んでください。"
              : "比較に使える分析結果がありません。案を保存し、正式な比較を計算してください。";
  return {
    evaluation,
    loading,
    message,
    refresh: async (canContinue: () => boolean) => {
      const canRefresh = () => canContinue() && refreshIdentity.current === queryIdentity;
      if (!usePublished || !canRefresh()) return;
      const status = await statusQuery.refetch({ cancelRefetch: false });
      // A new publication starts its own reads. Never refresh its predecessor or let
      // a mutable observer retarget this continuation after a scope change.
      if (
        !canRefresh() ||
        !status.isSuccess ||
        !query ||
        status.data.currentArtifact?.artifactId !== query.artifactId
      )
        return;
      try {
        const scopeStatus = await queryClient.fetchQuery({
          ...seriesAnalysisScopeStatusQueryOptions(query),
          staleTime: 0,
        });
        if (!canRefresh() || scopeStatus.state !== "available") return;
        await queryClient.refetchQueries(
          {
            queryKey: seriesAnalysisAggregateQueryOptions(query).queryKey,
            exact: true,
            type: "active",
          },
          { cancelRefetch: false },
        );
      } catch {
        // The query retains its failure for the editor's explicit retry.
      }
    },
  };
}
