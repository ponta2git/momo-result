import { DataTable, FactList, PageContentSurface, contentText } from "momo-result-ui";

type Row = { rank: number; player: string; assets: string };

const rows: Row[] = [
  { rank: 1, player: "ももたろう", assets: "128,400万円" },
  { rank: 2, player: "きんたろう", assets: "97,200万円" },
  { rank: 3, player: "うらしま", assets: "64,850万円" },
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
            { id: "winner", label: "優勝", value: "ももたろう" },
            { id: "assets", label: "優勝者の総資産", value: "128,400万円" },
          ]}
        />
      </div>
    </PageContentSurface>
  </div>
);

export const Compact = () => (
  <div className="p-4" style={{ background: "var(--color-canvas)" }}>
    <PageContentSurface padding="compact">
      <p className={contentText.body}>
        まだ試合結果が登録されていません。最初の試合を登録するとここに順位表が表示されます。
      </p>
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
          { key: "player", header: "プレイヤー", rowHeader: true, renderCell: (row) => row.player },
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
