import { useLocation } from "react-router-dom";

import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { OutlookView } from "@/features/seriesComparison/outlook/OutlookView";
import { OutlookSummaryBoundary } from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { OutlookWorkspace } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspace";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

export type OutlookWorkspaceProps = {
  summary: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisSelection;
  onMemberChange?: ((role: "focus" | "rival", memberId: string) => void) | undefined;
  onPairChange?: ((focusMemberId: string, rivalMemberId: string) => void) | undefined;
};

/**
 * Prototype of the rebuilt outlook: one workspace without sub-tabs. `outlookLayout=current`
 * keeps the released layout reachable for side-by-side trials.
 */
export function OutlookWorkspaceView(props: OutlookWorkspaceProps) {
  const { summary, selection, onMemberChange } = props;
  const location = useLocation();
  if (new URLSearchParams(location.search).get("outlookLayout") === "current")
    return <OutlookView summary={summary} selection={selection} onMemberChange={onMemberChange} />;
  return (
    <OutlookSummaryBoundary
      response={summary}
      selection={selection}
      empty={
        <p className={cn(contentText.body, readableTextWidthClass)}>
          この範囲に確定済みの試合がありません。
        </p>
      }
    >
      <OutlookWorkspace {...props} />
    </OutlookSummaryBoundary>
  );
}
