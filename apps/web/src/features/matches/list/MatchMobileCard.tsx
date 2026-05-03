import { MatchListActions } from "@/features/matches/list/MatchListActions";
import { formatDateTime, formatMatchNo } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { StatusPill } from "@/shared/ui/status/StatusPill";

type MatchMobileCardProps = {
  item: MatchListItemView;
};

export function MatchMobileCard({ item }: MatchMobileCardProps) {
  return (
    <article className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <StatusPill {...(item.hasWarnings ? { note: "要確認" } : {})} status={item.status} />
        <div className="min-w-0 text-right text-xs text-[var(--color-text-secondary)]">
          <p>{formatDateTime(item.heldAt)}</p>
          <p>{formatMatchNo(item.matchNoInEvent)}</p>
        </div>
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
        <p className="text-sm text-[var(--color-text-secondary)]">
          {item.ranks.length > 0
            ? item.ranks.map((rank) => `${rank.rank}位 ${rank.displayName}`).join(" / ")
            : "順位はまだ確定していません"}
        </p>
        {item.statusDescription ? (
          <p className="text-sm text-[var(--color-text-secondary)]">{item.statusDescription}</p>
        ) : null}
      </div>

      <div className="mt-4">
        <MatchListActions
          primaryAction={item.primaryAction}
          secondaryActions={item.secondaryActions}
        />
      </div>
    </article>
  );
}
