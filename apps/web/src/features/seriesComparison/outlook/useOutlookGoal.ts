import type { CumulativePair } from "@/features/seriesComparison/outlook/calculation";
import { outlookApplyView } from "@/features/seriesComparison/outlook/outlookProjections";
import type { OutlookResultView } from "@/features/seriesComparison/outlook/outlookProjections";
import type { OutlookGoalExpectation } from "@/features/seriesComparison/outlook/outlookProposals";
import {
  useOutlookEdit,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { useOutlookReferenceResources } from "@/features/seriesComparison/outlook/useOutlookReferenceResources";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

/** The goal's input, its same-length record, and the applications it offers. */
export function useOutlookGoal({
  response,
  focusMemberId,
  view,
  cumulative,
}: {
  response: SeriesAnalysisOutlookSummary;
  focusMemberId: string;
  view: OutlookResultView;
  cumulative: CumulativePair;
}) {
  const edit = useOutlookEdit();
  const blocks = useOutlookProjection(outlookApplyView);
  const { window } = useOutlookReferenceResources(response, focusMemberId, view.goalHorizon, false);
  const historical =
    view.goalHorizon === 50 || view.goalHorizon === 100
      ? response.bestWindows.find(
          (item) => item.memberId === focusMemberId && item.windowSize === view.goalHorizon,
        )
      : window.data;
  const expected: OutlookGoalExpectation = {
    key: view.key,
    artifactId: view.artifactId,
    horizon: view.goalHorizon,
    rival: view.rival,
    cumulative,
  };
  return {
    blocks,
    historical,
    window,
    expected,
    changeHorizon: (text: string) => edit({ kind: "goal-horizon", text }),
    apply: (maximumHundredths: number) => edit({ kind: "apply-goal", expected, maximumHundredths }),
  };
}
