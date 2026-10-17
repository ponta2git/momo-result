import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";

import { radarEditingEvaluation } from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import type { RadarEditingModel } from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { seriesAnalysisScopeStatusQueryOptions } from "@/shared/api/seriesPlayerRadar";

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
  const presentation = radarEditingEvaluation({
    active,
    currentBasisId,
    scope,
    prepared,
    query,
    aggregate: aggregateQuery.data,
    scopeState: scopeQuery.data?.state,
    fetching: statusQuery.isFetching || scopeQuery.isFetching || aggregateQuery.isFetching,
    failed: statusQuery.isError || scopeQuery.isError || aggregateQuery.isError,
  });
  return {
    ...presentation,
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
