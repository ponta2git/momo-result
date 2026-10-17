import { useMemo } from "react";

import type { CumulativePair, RankDistribution } from "@/features/seriesComparison/model/outlook";
import { applyOutlookGoal } from "@/features/seriesComparison/outlook/outlookApplication";
import type {
  OutlookHistoricalWindow,
  OutlookResourceView,
} from "@/features/seriesComparison/outlook/outlookResourceModel";
import {
  useOutlookInternalStore,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import {
  outlookGoalInput,
  outlookGoalView,
} from "@/features/seriesComparison/outlook/outlookViews";
import type { OutlookGoalView } from "@/features/seriesComparison/outlook/outlookViews";
import { useOutlookResource } from "@/features/seriesComparison/outlook/useOutlookResource";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

export type OutlookGoalModel = OutlookGoalView &
  Readonly<{
    historical: OutlookHistoricalWindow | undefined;
    window: OutlookResourceView["window"];
    apply: () => boolean;
  }>;

export function useOutlookGoalModel({
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
  const store = useOutlookInternalStore();
  const input = useOutlookProjection(outlookGoalInput);
  const view = useMemo(
    () => outlookGoalView(input, cumulative, recent),
    [input, cumulative, recent],
  );
  const { window } = useOutlookResource(response, memberIds[0], view.goalHorizon, false);
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
    store.commit(result.session);
    return result.applied;
  };
  return { ...view, historical, window, apply };
}
