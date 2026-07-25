import { MatchListExportLink } from "@/features/matches/list/MatchListExportLink";
import { MatchListMatchIdentity } from "@/features/matches/list/MatchListMatchIdentity";
import { MatchListResultLink } from "@/features/matches/list/MatchListResultLink";
import { MatchListStatusAction } from "@/features/matches/list/MatchListStatusAction";
import { MatchListStatusSummary } from "@/features/matches/list/MatchListStatusSummary";
import type {
  MatchListItemView,
  MatchListRowActions,
} from "@/features/matches/list/matchListTypes";

type MatchMobileCardProps = {
  item: MatchListItemView;
  rowActions: MatchListRowActions;
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

export function MatchMobileCard({ item, rowActions }: MatchMobileCardProps) {
  const actionsDisabled = rowActions.disabled ?? false;
  const ranksAside = otherRanks(item);

  return (
    <article className="momo-enter flex min-h-48 flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <MatchListMatchIdentity item={item} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <MatchListResultLink disabled={actionsDisabled} item={item} />
          <MatchListExportLink disabled={actionsDisabled} item={item} />
        </div>
      </div>

      <div className="mt-3">
        <MatchListStatusSummary item={item} />
      </div>

      <div className="mt-3">
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
      </div>

      <div className="mt-auto pt-4">
        <MatchListStatusAction item={item} layout="stacked" rowActions={rowActions} />
      </div>
    </article>
  );
}
