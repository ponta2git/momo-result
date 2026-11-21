import { ArrowLeftRight } from "lucide-react";
import { useMemo } from "react";

import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { formatRational, rational } from "@/features/seriesComparison/outlook/calculation";
import { buildOutlookComparisonView } from "@/features/seriesComparison/outlook/outlookProjections";
import { OutlookComparisonLayout } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceLayout";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { contentText } from "@/shared/ui/typography";

/** Who is compared and where they stand now. It reads only the summary and the URL selection. */
export function OutlookComparisonRow({
  summary,
  selection,
  onMemberChange,
  onPairChange,
}: {
  summary: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisSelection;
  onMemberChange?: ((role: "focus" | "rival", memberId: string) => void) | undefined;
  onPairChange?: ((focusMemberId: string, rivalMemberId: string) => void) | undefined;
}) {
  const { memberIds, names, displayRoles, cumulative } = useMemo(
    () => buildOutlookComparisonView(summary, selection.focusMemberId, selection.rivalMemberId),
    [summary, selection.focusMemberId, selection.rivalMemberId],
  );
  const games = BigInt(cumulative.games);
  const averages = [
    rational(BigInt(cumulative.focusRankSum), games),
    rational(BigInt(cumulative.rivalRankSum), games),
  ] as const;
  const difference = cumulative.rivalRankSum - cumulative.focusRankSum;
  const lead = rational(BigInt(Math.abs(difference)), games);
  return (
    <OutlookComparisonLayout
      people={
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          {([0, 1] as const).map((role) => (
            <SelectField
              key={role}
              label={role === 0 ? "注目する人" : "比較する相手"}
              value={memberIds[role]}
              options={orderFixedMembers(summary.players).map((player) => ({
                label: player.displayName,
                value: player.memberId,
                disabled: player.memberId === memberIds[role === 0 ? 1 : 0],
              }))}
              onValueChange={(id) => onMemberChange?.(role === 0 ? "focus" : "rival", id)}
            />
          ))}
          <IconButton
            variant="quiet"
            icon={<ArrowLeftRight />}
            aria-label="注目する人と比較する相手を入れ替える"
            tooltip="入れ替える"
            onClick={() => onPairChange?.(memberIds[1], memberIds[0])}
          />
        </div>
      }
      standing={
        <div className="grid min-w-0 gap-2">
          <p className={contentText.supporting}>
            {selection.seasonMasterId ? "今のシーズン総合平均" : "今の総合平均"}（
            {summary.scope.matchCount}戦）
          </p>
          <p
            className={cn(
              contentText.body,
              "flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 tabular-nums",
            )}
          >
            {displayRoles.map(({ memberId, role }) => (
              <span key={memberId} className="inline-flex items-center">
                <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>
                <span className="ml-1.5">{formatRational(averages[role], 2)}位</span>
              </span>
            ))}
            <span className="text-text-primary">
              {difference === 0
                ? "同率"
                : `${difference > 0 ? names[0] : names[1]}が ${formatRational(lead, 2)} 先行`}
            </span>
          </p>
        </div>
      }
    />
  );
}
