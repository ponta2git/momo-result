import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import {
  seriesAnalysisOutlookExamplesQueryOptions,
  seriesAnalysisOutlookWindowQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";

export function useOutlookResource(
  response: SeriesAnalysisOutlookSummary,
  memberId: string,
  windowSize: number | undefined,
  examplesOpen: boolean,
) {
  const queryClient = useQueryClient();
  const identity = {
    gameTitleId: response.artifact.gameTitleId,
    artifactId: response.artifact.artifactId,
    memberId,
  };
  const windowParams =
    windowSize === undefined || windowSize === 50 || windowSize === 100
      ? undefined
      : { ...identity, windowSize };
  const examplesParams = examplesOpen ? identity : undefined;
  const window = useQuery(seriesAnalysisOutlookWindowQueryOptions(windowParams));
  const examples = useQuery(seriesAnalysisOutlookExamplesQueryOptions(examplesParams));
  const refetchStatus = useCallback(
    async () => ({
      data: await queryClient.fetchQuery({
        ...seriesAnalysisStatusQueryOptions(response.artifact.gameTitleId),
        staleTime: 0,
      }),
    }),
    [queryClient, response.artifact.gameTitleId],
  );
  useAnalysisArtifactRecovery({
    artifactId: windowParams?.artifactId,
    error: window.error,
    queryKey: seriesAnalysisKeys.outlookWindow(windowParams),
    refetchArtifact: window.refetch,
    refetchStatus,
  });
  useAnalysisArtifactRecovery({
    artifactId: examplesParams?.artifactId,
    error: examples.error,
    queryKey: seriesAnalysisKeys.outlookExamples(examplesParams),
    refetchArtifact: examples.refetch,
    refetchStatus,
  });
  return { window, examples };
}
