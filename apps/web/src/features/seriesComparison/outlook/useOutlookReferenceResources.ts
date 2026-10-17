import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import type { OutlookReferenceResources } from "@/features/seriesComparison/outlook/outlookReferenceTypes";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import {
  seriesAnalysisOutlookExamplesQueryOptions,
  seriesAnalysisOutlookWindowQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";

export function useOutlookReferenceResources(
  response: SeriesAnalysisOutlookSummary,
  memberId: string,
  windowSize: number | undefined,
  examplesOpen: boolean,
): OutlookReferenceResources {
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
  const refreshPublication = useCallback(async () => {
    const status = await queryClient.fetchQuery({
      ...seriesAnalysisStatusQueryOptions(response.artifact.gameTitleId),
      staleTime: 0,
    });
    return status.currentArtifact?.artifactId;
  }, [queryClient, response.artifact.gameTitleId]);
  useAnalysisArtifactRecovery({
    artifactId: windowParams?.artifactId,
    error: window.error,
    resourceId: JSON.stringify(["outlook-window", windowParams]),
    refreshResource: retryWindow,
    refreshPublication,
  });
  useAnalysisArtifactRecovery({
    artifactId: examplesParams?.artifactId,
    error: examples.error,
    resourceId: JSON.stringify(["outlook-examples", examplesParams]),
    refreshResource: retryExamples,
    refreshPublication,
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
