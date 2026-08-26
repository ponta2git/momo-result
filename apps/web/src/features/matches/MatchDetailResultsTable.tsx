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
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { PlayOrderMark } from "@/shared/ui/data/PlayOrderMark";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

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
        minWidth: "8rem",
        renderCell: (player) => <PlayOrderMark playOrder={player.playOrder} />,
      }),
      sortable("member", {
        header: "プレーヤー",
        minWidth: "10rem",
        renderCell: (player) => (
          <MemberSequenceLabel memberId={player.memberId}>
            {memberDisplayName(player.memberId)}
          </MemberSequenceLabel>
        ),
        rowHeader: true,
      }),
      sortable("rank", {
        align: "right",
        header: "順位",
        minWidth: "5rem",
        renderCell: (player) => <RankBadge rank={player.rank} />,
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

  return (
    <DataTable
      caption={{ content: "試合結果" }}
      columns={columns}
      getRowKey={matchDetailPlayerRowKey}
      rows={players}
    />
  );
}
