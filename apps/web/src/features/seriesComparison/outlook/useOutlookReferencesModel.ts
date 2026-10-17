import { useCallback, useMemo } from "react";

import { applyOutlookExample } from "@/features/seriesComparison/outlook/outlookApplication";
import type {
  HistoricalOutlookExample,
  OutlookResourceView,
} from "@/features/seriesComparison/outlook/outlookResourceModel";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import {
  useOutlookEdit,
  useOutlookInternalStore,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import {
  outlookReferenceInput,
  outlookReferenceView,
} from "@/features/seriesComparison/outlook/outlookViews";
import type {
  OutlookReferenceCondition,
  OutlookReferenceView,
} from "@/features/seriesComparison/outlook/outlookViews";
import { useOutlookResource } from "@/features/seriesComparison/outlook/useOutlookResource";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

export type ExampleCondition = OutlookReferenceCondition & {
  onUsePerformance?: (() => void) | undefined;
  pendingDescriptionId?: string | undefined;
};
export type OutlookReferencesModel = OutlookReferenceView &
  Readonly<{
    query: OutlookResourceView["examples"];
    setOpen: (open: boolean) => void;
    apply: (example: HistoricalOutlookExample) => void;
  }>;

export function useOutlookReferencesModel(
  response: SeriesAnalysisOutlookSummary,
  memberId: string,
  condition: ExampleCondition,
): OutlookReferencesModel {
  const store = useOutlookInternalStore();
  const edit = useOutlookEdit();
  const role = condition.kind === "goal" ? 0 : condition.role;
  const input = useOutlookProjection(
    useCallback((session: OutlookSession) => outlookReferenceInput(session, role), [role]),
  );
  const { examples: query } = useOutlookResource(response, memberId, undefined, input.open);
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
    store.commit(result.session);
    if (result.applied && condition.kind === "goal") condition.onUsePerformance?.();
  };
  return {
    ...view,
    query,
    setOpen: (open: boolean) => edit({ kind: "examples-open", role, open }),
    apply,
  };
}
