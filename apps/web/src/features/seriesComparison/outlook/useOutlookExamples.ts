import { useMemo } from "react";

import type {
  RankDistribution,
  RequiredMean,
} from "@/features/seriesComparison/outlook/calculation";
import { outlookGoalExampleList } from "@/features/seriesComparison/outlook/outlookAnswers";
import type { OutlookGoalExpectation } from "@/features/seriesComparison/outlook/outlookProposals";
import type { HistoricalOutlookExample } from "@/features/seriesComparison/outlook/outlookReferenceTypes";
import { useOutlookEdit } from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { useOutlookReferenceResources } from "@/features/seriesComparison/outlook/useOutlookReferenceResources";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

/** The focus person's past 20-game examples that strictly meet the goal, read when opened. */
export function useOutlookGoalExamples({
  response,
  focusMemberId,
  open,
  required,
  rival,
  expected,
}: {
  response: SeriesAnalysisOutlookSummary;
  focusMemberId: string;
  open: boolean;
  required: RequiredMean;
  rival: RankDistribution;
  expected: OutlookGoalExpectation;
}) {
  const edit = useOutlookEdit();
  const { examples: query } = useOutlookReferenceResources(
    response,
    focusMemberId,
    undefined,
    open,
  );
  const list = useMemo(
    () => outlookGoalExampleList(query.data, required, rival),
    [query.data, required, rival],
  );
  return {
    query,
    list,
    apply: (example: HistoricalOutlookExample) =>
      edit({ kind: "apply-example", expected, example }),
  };
}
