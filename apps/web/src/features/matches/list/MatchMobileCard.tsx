import { MatchListActions } from "@/features/matches/list/MatchListActions";
import {
  formatCompactDateTime,
  formatGameSeason,
  formatMatchNo,
} from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { StatusPill } from "@/shared/ui/status/StatusPill";

type MatchMobileCardProps = {
  actionsDisabled?: boolean;
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

export function MatchMobileCard({ actionsDisabled = false, item }: MatchMobileCardProps) {
  const ranksAside = otherRanks(item);

  return (
    <article className="momo-enter flex min-h-52 flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
            <span className="tabular-nums">{formatCompactDateTime(item.heldAt)}</span>
            <span className="min-w-0 truncate">
              {formatGameSeason(item.gameTitleName, item.seasonName)}
            </span>
          </div>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-[var(--color-text-primary)]">
            <span className="shrink-0">{formatMatchNo(item.matchNoInEvent)}</span>
            <span className="min-w-0 truncate rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-1.5 py-0.5">
              {item.mapName ?? "マップ未設定"}
            </span>
          </p>
        </div>
        <StatusPill {...(item.hasWarnings ? { note: "要確認" } : {})} status={item.status} />
      </div>

      <div className="mt-3 grid gap-2">
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
          disabled={actionsDisabled}
          primaryAction={item.primaryAction}
          secondaryActions={item.secondaryActions}
        />
      </div>
    </article>
  );
}
