import { useEffect, useRef } from "react";

import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { isAnalysisArtifactExpired } from "@/shared/api/problemDetails";
import type {
  SeriesAnalysisMatchContextQuery,
  SeriesAnalysisQuery,
  SeriesAnalysisStatusResponse,
} from "@/shared/api/seriesAnalysis";

type RefetchStatus = () => Promise<{ data: SeriesAnalysisStatusResponse | undefined }>;

/** Retries each resource identity at most once when an immutable artifact has expired. */
export function useSeriesAnalysisArtifactRecovery(input: {
  activeError: unknown;
  activeQuery: SeriesAnalysisQuery | undefined;
  activeView: SeriesAnalysisViewId;
  contextError: unknown;
  contextQuery: SeriesAnalysisMatchContextQuery | undefined;
  refetchActive: () => Promise<unknown>;
  refetchContext: () => Promise<unknown>;
  refetchStatus: RefetchStatus;
}) {
  const handledResources = useRef(new Set<string>());
  const {
    activeError,
    activeQuery,
    activeView,
    contextError,
    contextQuery,
    refetchActive,
    refetchContext,
    refetchStatus,
  } = input;

  useEffect(() => {
    const artifactId = activeQuery?.artifactId;
    if (!artifactId) return;
    const queryIdentity = [
      artifactId,
      activeQuery.gameTitleId,
      activeQuery.seasonMasterId ?? "",
      activeQuery.mapMasterId ?? "",
    ].join("|");
    const activeResourceKey = `${activeView}|${queryIdentity}`;
    const contextResourceKey = contextQuery
      ? `context|${queryIdentity}|${contextQuery.matchId}`
      : undefined;
    const retryActive =
      isAnalysisArtifactExpired(activeError) && !handledResources.current.has(activeResourceKey);
    const retryContext = Boolean(
      isAnalysisArtifactExpired(contextError) &&
      contextResourceKey &&
      !handledResources.current.has(contextResourceKey),
    );
    const unhandledKeys = [
      ...(retryActive ? [activeResourceKey] : []),
      ...(retryContext && contextResourceKey ? [contextResourceKey] : []),
    ];
    if (unhandledKeys.length === 0) return;
    unhandledKeys.forEach((key) => handledResources.current.add(key));
    void refetchStatus().then((result) => {
      if (result.data?.currentArtifact?.artifactId === artifactId) {
        return Promise.all([
          ...(retryActive ? [refetchActive()] : []),
          ...(retryContext ? [refetchContext()] : []),
        ]);
      }
      return undefined;
    });
  }, [
    activeError,
    activeQuery?.artifactId,
    activeQuery?.gameTitleId,
    activeQuery?.mapMasterId,
    activeQuery?.seasonMasterId,
    activeView,
    contextError,
    contextQuery,
    refetchActive,
    refetchContext,
    refetchStatus,
  ]);
}
