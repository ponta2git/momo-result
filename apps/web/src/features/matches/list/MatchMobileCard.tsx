import { MatchListActions } from "@/features/matches/list/MatchListActions";
import { formatDateTime, formatMatchNo } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { StatusPill } from "@/shared/ui/status/StatusPill";

type MatchMobileCardProps = {
  item: MatchListItemView;
};

function rankSummary(item: MatchListItemView): string {
  const winner = item.ranks.find((rank) => rank.rank === 1);
  if (!winner) {
    return "順位はまだ確定していません";
  }
  return `優勝 ${winner.displayName}`;
}

function otherRanks(item: MatchListItemView): string {
  return item.ranks
    .filter((rank) => rank.rank !== 1)
    .map((rank) => `${rank.rank}位 ${rank.displayName}`)
    .join(" / ");
}

export function MatchMobileCard({ item }: MatchMobileCardProps) {
  const ranksAside = otherRanks(item);

  return (
    <article className="momo-enter flex min-h-52 flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="w-fit rounded-full border border-[var(--color-action)]/35 bg-[var(--color-action)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--color-text-primary)]">
            {formatMatchNo(item.matchNoInEvent)}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)] tabular-nums">
            {formatDateTime(item.heldAt)}
          </p>
        </div>
        <StatusPill {...(item.hasWarnings ? { note: "要確認" } : {})} status={item.status} />
      </div>

      <div className="mt-3 grid gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            {item.gameTitleName ?? "作品未設定"}
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {[item.seasonName, item.mapName].filter(Boolean).join(" / ") ||
              "シーズン・マップ未設定"}
          </p>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            {rankSummary(item)}
          </p>
          {ranksAside ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--color-text-secondary)]">
              {ranksAside}
            </p>
          ) : null}
        </div>
        {item.statusDescription ? (
          <p className="text-sm text-[var(--color-text-secondary)]">{item.statusDescription}</p>
        ) : null}
      </div>

      <div className="mt-auto pt-4">
        <MatchListActions
          primaryAction={item.primaryAction}
          secondaryActions={item.secondaryActions}
        />
      </div>
    </article>
  );
}
