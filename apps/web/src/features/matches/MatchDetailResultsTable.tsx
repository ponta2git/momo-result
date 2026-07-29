import { useMemo } from "react";

import type {
  MatchDetailPlayerResult,
  MatchDetailSortKey,
  MatchDetailSortState,
} from "@/features/matches/matchDetailViewModel";
import { incidentColumns } from "@/shared/domain/incidents";
import { memberDisplayName } from "@/shared/domain/members";
import { formatManYen } from "@/shared/lib/formatters";
import { DataTable } from "@/shared/ui/data/DataTable";
import type { DataTableColumn } from "@/shared/ui/data/DataTable";

const matchDetailPlayerRowKey = (player: MatchDetailPlayerResult) => player.memberId;

export function MatchDetailResultsTable({
  players,
  setSortKey,
  sort,
}: {
  players: MatchDetailPlayerResult[];
  setSortKey: (key: MatchDetailSortKey) => void;
  sort: MatchDetailSortState;
}) {
  const columns = useMemo<Array<DataTableColumn<MatchDetailPlayerResult>>>(() => {
    const sortable = (
      key: MatchDetailSortKey,
      column: Omit<DataTableColumn<MatchDetailPlayerResult>, "key" | "onSort" | "sortDirection">,
    ): DataTableColumn<MatchDetailPlayerResult> => ({
      ...column,
      key,
      onSort: () => setSortKey(key),
      sortDirection: sort.key === key ? sort.direction : undefined,
      sortable: true,
    });

    return [
      sortable("playOrder", {
        header: "プレー順",
        minWidth: "6rem",
        renderCell: (player) => player.playOrder,
      }),
      sortable("member", {
        header: "プレーヤー",
        minWidth: "10rem",
        renderCell: (player) => memberDisplayName(player.memberId),
      }),
      sortable("rank", {
        align: "right",
        header: "順位",
        minWidth: "5rem",
        renderCell: (player) => player.rank,
      }),
      sortable("totalAssetsManYen", {
        align: "right",
        header: "総資産",
        minWidth: "9rem",
        renderCell: (player) => (
          <span className="tabular-nums">{formatManYen(player.totalAssetsManYen)}</span>
        ),
      }),
      sortable("revenueManYen", {
        align: "right",
        header: "物件収益",
        minWidth: "9rem",
        renderCell: (player) => (
          <span className="tabular-nums">{formatManYen(player.revenueManYen)}</span>
        ),
      }),
      ...incidentColumns.map(([key, label]) =>
        sortable(key, {
          align: "right",
          header: label,
          minWidth: "6rem",
          renderCell: (player) => <span className="tabular-nums">{player.incidents[key]}</span>,
        }),
      ),
    ];
  }, [setSortKey, sort.direction, sort.key]);

  return <DataTable columns={columns} getRowKey={matchDetailPlayerRowKey} rows={players} />;
}
