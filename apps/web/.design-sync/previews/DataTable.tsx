import { DataTable, StatusBadge } from "momo-result-ui";

type Row = { rank: number; player: string; assets: number; revenue: number; destinations: number };

const rows: Row[] = [
  { rank: 1, player: "ももたろう", assets: 128_400, revenue: 23_500, destinations: 9 },
  { rank: 2, player: "きんたろう", assets: 97_200, revenue: 18_100, destinations: 7 },
  { rank: 3, player: "うらしま", assets: 64_850, revenue: 12_900, destinations: 5 },
  { rank: 4, player: "かぐや", assets: 31_300, revenue: 8_400, destinations: 3 },
];

const yen = (value: number) => `${value.toLocaleString("ja-JP")}万円`;

export const Standings = () => (
  <DataTable<Row>
    caption={{ content: "第12回 最終順位", visibility: "visible" }}
    columns={[
      {
        key: "rank",
        header: "順位",
        align: "right",
        tabular: true,
        width: "4rem",
        renderCell: (row) => `${row.rank}位`,
      },
      { key: "player", header: "プレイヤー", rowHeader: true, renderCell: (row) => row.player },
      {
        key: "assets",
        header: "総資産",
        align: "right",
        tabular: true,
        highlighted: true,
        renderCell: (row) => yen(row.assets),
      },
      {
        key: "revenue",
        header: "収益",
        align: "right",
        tabular: true,
        renderCell: (row) => yen(row.revenue),
      },
      {
        key: "destinations",
        header: "目的地",
        align: "right",
        tabular: true,
        renderCell: (row) => `${row.destinations}回`,
      },
    ]}
    getRowKey={(row) => row.player}
    rows={rows}
  />
);

export const SortableCompact = () => (
  <DataTable<Row>
    caption={{ content: "プレイヤー別の総資産" }}
    columns={[
      { key: "player", header: "プレイヤー", rowHeader: true, renderCell: (row) => row.player },
      {
        key: "assets",
        header: "総資産",
        align: "right",
        tabular: true,
        sortable: true,
        sortDirection: "desc",
        onSort: () => {},
        renderCell: (row) => yen(row.assets),
      },
      {
        key: "status",
        header: "状態",
        renderCell: (row) =>
          row.rank === 1 ? (
            <StatusBadge label="優勝" tone="success" />
          ) : (
            <StatusBadge label="確定" />
          ),
      },
    ]}
    density="compact"
    getRowKey={(row) => row.player}
    rows={rows}
  />
);

export const Empty = () => (
  <DataTable<Row>
    caption={{ content: "第13回 結果" }}
    columns={[
      { key: "player", header: "プレイヤー", renderCell: (row) => row.player },
      { key: "assets", header: "総資産", align: "right", renderCell: (row) => yen(row.assets) },
    ]}
    emptyState="まだ試合結果が登録されていません。"
    getRowKey={(row) => row.player}
    rows={[]}
  />
);
