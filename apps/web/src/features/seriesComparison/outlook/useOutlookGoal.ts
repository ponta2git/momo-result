import { useMemo } from "react";

import type {
  CumulativePair,
  RankDistribution,
} from "@/features/seriesComparison/outlook/calculation";
import {
  outlookGoalInput,
  outlookGoalView,
} from "@/features/seriesComparison/outlook/outlookProjections";
import type { OutlookGoalView } from "@/features/seriesComparison/outlook/outlookProjections";
import { applyOutlookGoal } from "@/features/seriesComparison/outlook/outlookProposals";
import type {
  OutlookHistoricalWindow,
  OutlookReferenceResources,
} from "@/features/seriesComparison/outlook/outlookReferenceTypes";
import {
  useOutlookWorkspaceStore,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { useOutlookReferenceResources } from "@/features/seriesComparison/outlook/useOutlookReferenceResources";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

export type OutlookGoalModel = OutlookGoalView &
  Readonly<{
    historical: OutlookHistoricalWindow | undefined;
    window: OutlookReferenceResources["window"];
    apply: () => boolean;
  }>;

export function useOutlookGoal({
  response,
  cumulative,
  memberIds,
  recent,
}: {
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  memberIds: readonly [string, string];
  recent: readonly [RankDistribution, RankDistribution];
}): OutlookGoalModel {
  const store = useOutlookWorkspaceStore();
  const input = useOutlookProjection(outlookGoalInput);
  const view = useMemo(
    () => outlookGoalView(input, cumulative, recent),
    [input, cumulative, recent],
  );
  const { window } = useOutlookReferenceResources(response, memberIds[0], view.goalHorizon, false);
  const historical =
    view.goalHorizon === 50 || view.goalHorizon === 100
      ? response.bestWindows.find(
          (item) => item.memberId === memberIds[0] && item.windowSize === view.goalHorizon,
        )
      : window.data;
  const apply = () => {
    const current = store.read();
    if (!current) return false;
    const result = applyOutlookGoal(current, {
      key: input.key,
      artifactId: response.artifact.artifactId,
      horizon: view.goalHorizon,
      rival: view.rival,
      maximum: view.maximum,
      cumulative,
    });
    store.commit(result.state);
    return result.applied;
  };
  return { ...view, historical, window, apply };
}
