import { MatchListActions } from "@/features/matches/list/MatchListActions";
import { formatDateTime, formatMatchNo } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView, MatchListSort } from "@/features/matches/list/matchListTypes";
import { DataTable } from "@/shared/ui/data/DataTable";
import { StatusPill } from "@/shared/ui/status/StatusPill";

type MatchesTableProps = {
  items: MatchListItemView[];
  sort: MatchListSort;
  onSortChange: (sort: MatchListSort) => void;
};

function nextHeldSort(sort: MatchListSort): MatchListSort {
  return sort === "held_desc" ? "held_asc" : "held_desc";
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

export function MatchesTable({ items, sort, onSortChange }: MatchesTableProps) {
  return (
    <DataTable
      columns={[
        {
          header: "試合",
          key: "match",
          minWidth: "17rem",
          onSort: () => onSortChange(nextHeldSort(sort)),
          renderCell: (item) => (
            <div className="grid gap-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="rounded-full border border-[var(--color-action)]/35 bg-[var(--color-action)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--color-text-primary)]">
                  {formatMatchNo(item.matchNoInEvent)}
                </span>
                <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                  {formatDateTime(item.heldAt)}
                </span>
              </div>
              <p className="font-semibold text-[var(--color-text-primary)]">
                {item.gameTitleName ?? "作品未設定"}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {[item.seasonName, item.mapName].filter(Boolean).join(" / ") ||
                  "シーズン・マップ未設定"}
              </p>
            </div>
          ),
          ...(sort === "held_desc"
            ? { sortDirection: "desc" as const }
            : sort === "held_asc"
              ? { sortDirection: "asc" as const }
              : {}),
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
          sortable: true,
        },
        {
          header: "操作",
          key: "actions",
          minWidth: "9rem",
          renderCell: (item) => (
            <MatchListActions
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
