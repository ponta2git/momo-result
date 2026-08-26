import type { HeldEventPlayerRecap as PlayerRecap } from "@/features/heldEvents/heldEventDetailViewModel";
import { formatAverageRank } from "@/features/heldEvents/heldEventDetailViewModel";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { RankTrail } from "@/shared/ui/rank/RankBadge";

export function HeldEventPlayerRecap({ recaps }: { recaps: PlayerRecap[] }) {
  if (recaps.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="held-event-recap-heading" className="min-w-0">
      <div>
        <h2 id="held-event-recap-heading" className="momo-heading text-base font-semibold">
          この開催の戦績
        </h2>
        <p className="momo-copy mt-1 text-sm text-[var(--color-text-secondary)]">
          勝数・平均順位と、試合順の順位推移です。
        </p>
      </div>
      <div className="mt-4 grid gap-x-6 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
        {recaps.map((recap) => (
          <section
            key={recap.memberId}
            aria-label={`${recap.displayName}の開催戦績`}
            className="min-w-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 font-semibold">
                <MemberSequenceLabel memberId={recap.memberId}>
                  <span className="truncate">{recap.displayName}</span>
                </MemberSequenceLabel>
              </h3>
              <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                {recap.matchCount}戦
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <dt className="momo-label text-[var(--color-text-secondary)]">勝数</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{recap.wins}勝</dd>
              </div>
              <div>
                <dt className="momo-label text-[var(--color-text-secondary)]">平均順位</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {formatAverageRank(recap.averageRank)}位
                </dd>
              </div>
            </dl>
            <div className="mt-3">
              <p className="momo-label text-[var(--color-text-secondary)]">順位推移</p>
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
