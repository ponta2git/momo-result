import type { AchievementResource } from "@/shared/api/achievements";
import { orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

export function AchievementPointsSummary({
  summary,
}: {
  summary: AchievementResource["summaries"][number];
}) {
  return (
    <dl aria-label="獲得／対象ポイント" className="grid grid-cols-2 gap-6 sm:grid-cols-4">
      {orderFixedMembers(summary.players).map((player) => (
        <div key={player.memberId} className="grid gap-2">
          <dt className={contentText.body}>
            <MemberSequenceLabel memberId={player.memberId}>
              {player.displayName}
            </MemberSequenceLabel>
          </dt>
          <dd className={cn(contentText.body, "tabular-nums")}>
            <span className={contentText.primary}>{player.earnedPoints}</span>
            <span>／{summary.totalPoints}ポイント</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
