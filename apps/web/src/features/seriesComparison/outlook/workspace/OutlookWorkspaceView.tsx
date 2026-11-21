import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
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

/** The outlook view: one workspace that answers both questions without sub-tabs. */
export function OutlookWorkspaceView(props: OutlookWorkspaceProps) {
  const { summary, selection } = props;
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
