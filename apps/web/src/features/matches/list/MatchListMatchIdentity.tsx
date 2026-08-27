import {
  formatCompactDateTime,
  formatGameSeason,
  formatMatchNo,
} from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";

type MatchListMatchIdentityProps = {
  item: MatchListItemView;
};

export function MatchListMatchIdentity({ item }: MatchListMatchIdentityProps) {
  return (
    <div className="grid gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
        <span className="tabular-nums">{formatCompactDateTime(item.heldAt)}</span>
        <span className="min-w-0 truncate">
          {formatGameSeason(item.gameTitleName, item.seasonName)}
        </span>
      </div>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-[var(--color-text-primary)]">
        <span className="shrink-0">{formatMatchNo(item.matchNoInEvent)}</span>
        <span className="min-w-0 truncate rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-2 py-0.5">
          {item.mapName ?? "マップ未設定"}
        </span>
      </p>
      {item.hasNote ? (
        <p className="text-xs font-medium text-[var(--color-text-secondary)]">メモあり</p>
      ) : null}
    </div>
  );
}
