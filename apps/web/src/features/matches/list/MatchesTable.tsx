import { MatchListActions } from "@/features/matches/list/MatchListActions";
import { formatDateTime, formatMatchNo } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView, MatchListSort } from "@/features/matches/list/matchListTypes";
import { DataTable } from "@/shared/ui/data/DataTable";
import { StatusRail } from "@/shared/ui/status/StatusRail";

type MatchesTableProps = {
  items: MatchListItemView[];
  sort: MatchListSort;
  onSortChange: (sort: MatchListSort) => void;
};

function nextHeldSort(sort: MatchListSort): MatchListSort {
  return sort === "held_desc" ? "held_asc" : "held_desc";
}

export function MatchesTable({ items, sort, onSortChange }: MatchesTableProps) {
  return (
    <DataTable
      columns={[
        {
          header: "状態",
          key: "status",
          minWidth: "9rem",
          renderCell: (item) => (
            <div className="grid gap-1">
              <StatusRail compact={item.displayStatus === "confirmed"} status={item.status} />
              {item.statusDescription ? (
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {item.statusDescription}
                </p>
              ) : null}
            </div>
          ),
        },
        {
          header: "開催",
          key: "held",
          minWidth: "12rem",
          onSort: () => onSortChange(nextHeldSort(sort)),
          renderCell: (item) => (
            <div className="grid gap-1">
              <p>{formatDateTime(item.heldAt)}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {formatMatchNo(item.matchNoInEvent)}
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
          header: "作品 / シーズン",
          key: "game",
          minWidth: "13rem",
          renderCell: (item) => (
            <div className="grid gap-1">
              <p className="font-medium">{item.gameTitleName ?? "作品未設定"}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {[item.seasonName, item.mapName].filter(Boolean).join(" / ") ||
                  "シーズン・マップ未設定"}
              </p>
            </div>
          ),
        },
        {
          header: "順位",
          key: "ranks",
          minWidth: "16rem",
          renderCell: (item) => (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {item.ranks.length > 0 ? (
                item.ranks.map((rank) => (
                  <p key={`${item.id}:${rank.memberId}`} className="truncate">
                    {rank.rank}位 {rank.displayName}
                  </p>
                ))
              ) : (
                <p className="text-[var(--color-text-secondary)]">順位はまだ確定していません</p>
              )}
            </div>
          ),
        },
        {
          header: "更新",
          key: "updated",
          minWidth: "10rem",
          onSort: () => onSortChange("updated_desc"),
          renderCell: (item) => (
            <div className="grid gap-1 text-xs">
              <p>{formatDateTime(item.updatedAt)}</p>
              <p className="text-[var(--color-text-secondary)]">
                作成 {formatDateTime(item.createdAt)}
              </p>
            </div>
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
