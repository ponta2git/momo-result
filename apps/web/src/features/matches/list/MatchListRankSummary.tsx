import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

export function MatchListRankSummary({ item }: { item: MatchListItemView }) {
  const ranks = item.ranks.toSorted((left, right) => left.rank - right.rank);
  const winner = ranks.find((rank) => rank.rank === 1);
  const others = ranks.filter((rank) => rank.rank !== 1);

  if (!winner) {
    return <p className="text-sm text-[var(--color-text-secondary)]">順位はまだ確定していません</p>;
  }

  return (
    <div className="grid gap-2">
      <p className="flex min-w-0 items-center gap-2">
        <RankBadge rank={winner.rank} />
        <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
          優勝 {winner.displayName}
        </span>
      </p>
      {others.length > 0 ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="2位以下の順位">
          {others.map((rank) => (
            <li key={rank.memberId} className="inline-flex min-w-0 items-center gap-2">
              <RankBadge rank={rank.rank} />
              <span className="max-w-28 truncate text-xs text-[var(--color-text-secondary)]">
                {rank.displayName}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
