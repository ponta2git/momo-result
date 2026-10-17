import { useCallback, useMemo } from "react";

import {
  outlookReferenceInput,
  outlookReferenceView,
} from "@/features/seriesComparison/outlook/outlookProjections";
import type {
  OutlookReferenceCondition,
  OutlookReferenceView,
} from "@/features/seriesComparison/outlook/outlookProjections";
import { applyOutlookExample } from "@/features/seriesComparison/outlook/outlookProposals";
import type {
  HistoricalOutlookExample,
  OutlookReferenceResources,
} from "@/features/seriesComparison/outlook/outlookReferenceTypes";
import {
  useOutlookEdit,
  useOutlookWorkspaceStore,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import type { OutlookWorkspaceState } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import { useOutlookReferenceResources } from "@/features/seriesComparison/outlook/useOutlookReferenceResources";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

export type OutlookExampleCondition = OutlookReferenceCondition & {
  onUsePerformance?: (() => void) | undefined;
  pendingDescriptionId?: string | undefined;
};
export type OutlookExamplesModel = OutlookReferenceView &
  Readonly<{
    query: OutlookReferenceResources["examples"];
    setOpen: (open: boolean) => void;
    apply: (example: HistoricalOutlookExample) => void;
  }>;

export function useOutlookExamples(
  response: SeriesAnalysisOutlookSummary,
  memberId: string,
  condition: OutlookExampleCondition,
): OutlookExamplesModel {
  const store = useOutlookWorkspaceStore();
  const edit = useOutlookEdit();
  const role = condition.kind === "goal" ? 0 : condition.role;
  const input = useOutlookProjection(
    useCallback((state: OutlookWorkspaceState) => outlookReferenceInput(state, role), [role]),
  );
  const { examples: query } = useOutlookReferenceResources(
    response,
    memberId,
    undefined,
    input.open,
  );
  const view = useMemo(
    () => outlookReferenceView(input, condition, query.data),
    [input, condition, query.data],
  );
  const apply = (example: HistoricalOutlookExample) => {
    const current = store.read();
    if (!current) return;
    const result = applyOutlookExample(
      current,
      {
        key: input.key,
        artifactId: response.artifact.artifactId,
        role,
        target: input.target,
        peer: input.peer,
        condition:
          condition.kind === "goal"
            ? { kind: "goal", cumulative: condition.cumulative, horizon: input.goalHorizon }
            : { kind: "mean" },
      },
      example,
    );
    store.commit(result.state);
    if (result.applied && condition.kind === "goal") condition.onUsePerformance?.();
  };
  return {
    ...view,
    query,
    setOpen: (open: boolean) => edit({ kind: "examples-open", role, open }),
    apply,
  };
}
