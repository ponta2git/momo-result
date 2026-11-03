import type { AchievementResource } from "@/shared/api/achievements";
import { canonicalResultMembers, orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { contentText } from "@/shared/ui/typography";

const summaryGridClass = "grid grid-cols-2 gap-4 sm:grid-cols-4";
const summaryEntryClass = "grid gap-2";

export function AchievementPointsSummary({
  summary,
}: {
  summary: AchievementResource["summaries"][number];
}) {
  return (
    <dl aria-label="獲得／対象ポイント" className={summaryGridClass}>
      {orderFixedMembers(summary.players).map((player) => (
        <div key={player.memberId} className={summaryEntryClass}>
          <dt className={cn(contentText.heading, "flex min-w-0")}>
            <MemberSequenceLabel memberId={player.memberId}>
              {player.displayName}
            </MemberSequenceLabel>
          </dt>
          {/* A flex line keeps the value as tall as its largest text, which the skeleton matches. */}
          <dd className={cn(contentText.body, "flex items-baseline tabular-nums")}>
            <span className={contentText.primary}>{player.earnedPoints}</span>
            <span>／{summary.totalPoints}ポイント</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Holds the summary's final grid and line heights until the published points arrive. */
export function AchievementPointsSkeleton() {
  return (
    <div aria-hidden="true" className={summaryGridClass}>
      {canonicalResultMembers.map((member) => (
        <div key={member.memberId} className={summaryEntryClass}>
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-7 w-28" />
        </div>
      ))}
    </div>
  );
}
