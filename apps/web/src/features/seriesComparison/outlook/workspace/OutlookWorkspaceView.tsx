import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { OutlookSummaryBoundary } from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { OutlookComparisonRow } from "@/features/seriesComparison/outlook/workspace/OutlookComparisonRow";
import { OutlookWorkspace } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspace";
import { OutlookWorkspaceFrame } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceLayout";
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
export function OutlookWorkspaceView({
  summary,
  selection,
  onMemberChange,
  onPairChange,
}: OutlookWorkspaceProps) {
  const empty = (
    <p className={cn(contentText.body, readableTextWidthClass)}>
      この範囲に確定済みの試合がありません。
    </p>
  );
  if (summary.players.length === 0) return empty;
  return (
    <OutlookWorkspaceFrame
      comparison={
        <OutlookComparisonRow
          summary={summary}
          selection={selection}
          onMemberChange={onMemberChange}
          onPairChange={onPairChange}
        />
      }
    >
      <OutlookSummaryBoundary response={summary} selection={selection} empty={empty}>
        <OutlookWorkspace summary={summary} selection={selection} />
      </OutlookSummaryBoundary>
    </OutlookWorkspaceFrame>
  );
}
