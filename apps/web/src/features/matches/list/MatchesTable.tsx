import { MatchListActions } from "@/features/matches/list/MatchListActions";
import {
  formatCompactDateTime,
  formatDateTime,
  formatGameSeason,
  formatMatchNo,
} from "@/features/matches/list/matchListFormat";
import type { MatchListItemView, MatchListSort } from "@/features/matches/list/matchListTypes";
import { DataTable } from "@/shared/ui/data/DataTable";
import { StatusPill } from "@/shared/ui/status/StatusPill";

type MatchesTableProps = {
  actionsDisabled?: boolean;
  items: MatchListItemView[];
  sort: MatchListSort;
  onSortChange: (sort: MatchListSort) => void;
};

function nextHeldSort(sort: MatchListSort): MatchListSort {
  return sort === "held_desc" ? "held_asc" : "held_desc";
}

function HeldMatchLabel({ item }: { item: MatchListItemView }) {
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
        <span className="min-w-0 truncate rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-1.5 py-0.5">
          {item.mapName ?? "マップ未設定"}
        </span>
      </p>
    </div>
  );
}

function RankSummary({ item }: { item: MatchListItemView }) {
  const winner = item.ranks.find((rank) => rank.rank === 1);
  const others = item.ranks.filter((rank) => rank.rank !== 1);

  if (!winner) {
    return <p className="text-sm text-[var(--color-text-secondary)]">順位はまだ確定していません</p>;
  }

  return (
    <div className="grid gap-1">
      <p className="text-sm font-semibold text-[var(--color-text-primary)]">
        優勝 {winner.displayName}
      </p>
      {others.length > 0 ? (
        <p className="line-clamp-2 text-xs leading-5 text-[var(--color-text-secondary)]">
          {others.map((rank) => `${rank.rank}位 ${rank.displayName}`).join(" / ")}
        </p>
      ) : null}
    </div>
  );
}

export function MatchesTable({
  actionsDisabled = false,
  items,
  sort,
  onSortChange,
}: MatchesTableProps) {
  return (
    <DataTable
      columns={[
        {
          header: "開催・試合",
          key: "match",
          minWidth: "17rem",
          onSort: () => onSortChange(nextHeldSort(sort)),
          renderCell: (item) => (
            <div className="grid gap-1">
              <HeldMatchLabel item={item} />
            </div>
          ),
          ...(sort === "held_desc"
            ? { sortDirection: "desc" as const }
            : sort === "held_asc"
              ? { sortDirection: "asc" as const }
              : {}),
          sortDisabled: actionsDisabled,
          sortable: true,
        },
        {
          header: "状態",
          key: "status",
          minWidth: "10rem",
          renderCell: (item) => (
            <div className="grid gap-1.5">
              <StatusPill {...(item.hasWarnings ? { note: "要確認" } : {})} status={item.status} />
              {item.statusDescription ? (
                <p className="line-clamp-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                  {item.statusDescription}
                </p>
              ) : null}
            </div>
          ),
        },
        {
          header: "結果",
          key: "ranks",
          minWidth: "15rem",
          renderCell: (item) => <RankSummary item={item} />,
        },
        {
          header: "更新",
          key: "updated",
          minWidth: "8rem",
          onSort: () => onSortChange("updated_desc"),
          renderCell: (item) => (
            <p className="text-xs text-[var(--color-text-secondary)] tabular-nums">
              {formatDateTime(item.updatedAt)}
            </p>
          ),
          ...(sort === "updated_desc" ? { sortDirection: "desc" as const } : {}),
          sortDisabled: actionsDisabled,
          sortable: true,
        },
        {
          header: "操作",
          key: "actions",
          minWidth: "9rem",
          renderCell: (item) => (
            <MatchListActions
              disabled={actionsDisabled}
              primaryAction={item.primaryAction}
              secondaryActions={item.secondaryActions}
            />
          ),
        },
      ]}
      getRowKey={(item) => item.id}
      rows={items}
    />
  );
}
