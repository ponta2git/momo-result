import type { HeldEventPlayerRecap as PlayerRecap } from "@/features/heldEvents/heldEventDetailViewModel";
import { formatAverageRank } from "@/features/heldEvents/heldEventDetailViewModel";
import { cn } from "@/shared/ui/cn";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { RankTrail } from "@/shared/ui/rank/RankBadge";
import { contentText } from "@/shared/ui/typography";

export function HeldEventPlayerRecap({ recaps }: { recaps: PlayerRecap[] }) {
  if (recaps.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="held-event-recap-heading" className="min-w-0">
      <div>
        <h2 id="held-event-recap-heading" className={contentText.heading}>
          この開催の戦績
        </h2>
      </div>
      <div className="mt-4 grid gap-x-6 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
        {recaps.map((recap) => (
          <section
            key={recap.memberId}
            aria-label={`${recap.displayName}の開催戦績`}
            className="min-w-0"
          >
            <h3 className={cn(contentText.heading, "min-w-0")}>
              <MemberSequenceLabel memberId={recap.memberId}>
                <span className="truncate">{recap.displayName}</span>
              </MemberSequenceLabel>
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <dt className={contentText.supporting}>1位回数</dt>
                <dd className={cn(contentText.primary, "mt-0.5 tabular-nums")}>{recap.wins}回</dd>
              </div>
              <div>
                <dt className={contentText.supporting}>平均順位</dt>
                <dd className={cn(contentText.primary, "mt-0.5 tabular-nums")}>
                  {formatAverageRank(recap.averageRank)}位
                </dd>
              </div>
            </dl>
            <div className="mt-2">
              <p className={contentText.supporting}>順位推移</p>
              <div className="mt-1 overflow-x-auto pb-1">
                <RankTrail
                  ariaLabel={`${recap.displayName}の順位推移 ${recap.ranks.map((rank) => `${rank}位`).join("、")}`}
                  ranks={recap.ranks}
                />
              </div>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
