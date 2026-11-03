import { DataTable, FactList, PageContentSurface, contentText } from "momo-result-ui";

type Row = { rank: number; player: string; assets: string };

const rows: Row[] = [
  { rank: 1, player: "いーゆー", assets: "128,400万円" },
  { rank: 2, player: "ぽんた", assets: "97,200万円" },
  { rank: 3, player: "あかねまみ", assets: "64,850万円" },
];

export const Default = () => (
  <div className="p-4" style={{ background: "var(--color-canvas)" }}>
    <PageContentSurface>
      <h2 className={contentText.heading}>第12回 桃鉄リーグ</h2>
      <div className="mt-3">
        <FactList
          ariaLabel="第12回の概要"
          columns={2}
          items={[
            { id: "date", label: "開催日", value: "2026/10/24" },
            { id: "years", label: "プレイ年数", value: "30年" },
            { id: "winner", label: "優勝", value: "いーゆー" },
            { id: "assets", label: "優勝者の総資産", value: "128,400万円" },
          ]}
        />
      </div>
    </PageContentSurface>
  </div>
);

export const FlushTable = () => (
  <div className="p-4" style={{ background: "var(--color-canvas)" }}>
    <PageContentSurface padding="none">
      <DataTable<Row>
        caption={{ content: "最終順位" }}
        columns={[
          {
            key: "rank",
            header: "順位",
            align: "right",
            tabular: true,
            width: "4rem",
            renderCell: (row) => `${row.rank}位`,
          },
          { key: "player", header: "プレーヤー", rowHeader: true, renderCell: (row) => row.player },
          {
            key: "assets",
            header: "総資産",
            align: "right",
            tabular: true,
            renderCell: (row) => row.assets,
          },
        ]}
        getRowKey={(row) => row.player}
        rows={rows}
      />
    </PageContentSurface>
  </div>
);
