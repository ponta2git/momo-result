import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import type { OutlookResourceView } from "@/features/seriesComparison/outlook/outlookResourceModel";
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
): OutlookResourceView {
  const queryClient = useQueryClient();
  const [settledSize, setSettledSize] = useState(windowSize);
  useEffect(() => {
    if (settledSize === windowSize) return;
    const timeout = setTimeout(() => setSettledSize(windowSize), 180);
    return () => clearTimeout(timeout);
  }, [settledSize, windowSize]);
  const identity = {
    gameTitleId: response.artifact.gameTitleId,
    artifactId: response.artifact.artifactId,
    memberId,
  };
  const windowParams =
    settledSize !== windowSize ||
    windowSize === undefined ||
    windowSize === 50 ||
    windowSize === 100
      ? undefined
      : { ...identity, windowSize };
  const examplesParams = examplesOpen ? identity : undefined;
  const window = useQuery(seriesAnalysisOutlookWindowQueryOptions(windowParams));
  const examples = useQuery(seriesAnalysisOutlookExamplesQueryOptions(examplesParams));
  const { refetch: refetchWindow } = window;
  const { refetch: refetchExamples } = examples;
  const retryWindow = useCallback(async () => {
    await refetchWindow();
  }, [refetchWindow]);
  const retryExamples = useCallback(async () => {
    await refetchExamples();
  }, [refetchExamples]);
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
  return {
    window: {
      data: window.data,
      hasError: window.isError,
      refreshing: window.isFetching,
      retry: retryWindow,
    },
    examples: {
      data: examples.data,
      hasError: examples.isError,
      refreshing: examples.isFetching,
      retry: retryExamples,
    },
  };
}
