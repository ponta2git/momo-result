import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { cn } from "@/shared/ui/cn";
import { RankBadge } from "@/shared/ui/rank/RankBadge";
import { contentText } from "@/shared/ui/typography";

export function MatchListRankSummary({ item }: { item: MatchListItemView }) {
  const ranks = item.ranks.toSorted((left, right) => left.rank - right.rank);
  const winner = ranks.find((rank) => rank.rank === 1);
  const others = ranks.filter((rank) => rank.rank !== 1);

  if (!winner) {
    return <p className={contentText.body}>順位はまだ確定していません</p>;
  }

  return (
    <div className="grid gap-2">
      <p className="flex min-w-0 items-center gap-2">
        <RankBadge rank={winner.rank} />
        <span className={cn(contentText.compactPrimary, "truncate")}>
          優勝 {winner.displayName}
        </span>
      </p>
      {others.length > 0 ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="2位以下の順位">
          {others.map((rank) => (
            <li key={rank.memberId} className="inline-flex min-w-0 items-center gap-2">
              <RankBadge rank={rank.rank} />
              <span className={cn(contentText.body, "max-w-28 truncate")}>{rank.displayName}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
