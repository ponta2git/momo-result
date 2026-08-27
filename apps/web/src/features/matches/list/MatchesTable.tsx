import { MatchListExportLink } from "@/features/matches/list/MatchListExportLink";
import { MatchListMatchIdentity } from "@/features/matches/list/MatchListMatchIdentity";
import { MatchListRankSummary } from "@/features/matches/list/MatchListRankSummary";
import { MatchListResultLink } from "@/features/matches/list/MatchListResultLink";
import { MatchListStatusAction } from "@/features/matches/list/MatchListStatusAction";
import { MatchListStatusSummary } from "@/features/matches/list/MatchListStatusSummary";
import type {
  MatchListItemView,
  MatchListRowActions,
} from "@/features/matches/list/matchListTypes";
import { DataTable } from "@/shared/ui/data/DataTable";

type MatchesTableProps = {
  items: MatchListItemView[];
  rowActions: MatchListRowActions;
};

export function MatchesTable({ items, rowActions }: MatchesTableProps) {
  const actionsDisabled = rowActions.disabled ?? false;
  return (
    <DataTable
      caption={{ content: "登録済みの試合" }}
      columns={[
        {
          header: "開催・試合",
          key: "match",
          minWidth: "15rem",
          renderCell: (item) => <MatchListMatchIdentity item={item} />,
          rowHeader: true,
          width: "17rem",
        },
        {
          header: "状態・次の操作",
          key: "status",
          minWidth: "12rem",
          renderCell: (item) => (
            <div className="grid gap-3">
              <MatchListStatusSummary item={item} />
              <MatchListStatusAction item={item} rowActions={rowActions} />
            </div>
          ),
          width: "13rem",
        },
        {
          header: "順位",
          key: "ranks",
          minWidth: "13rem",
          renderCell: (item) => <MatchListRankSummary item={item} />,
        },
        {
          align: "center",
          header: "結果",
          key: "detail",
          minWidth: "4.5rem",
          renderCell: (item) => <MatchListResultLink disabled={actionsDisabled} item={item} />,
          width: "4.5rem",
        },
        {
          align: "center",
          header: "出力",
          key: "export",
          minWidth: "4.5rem",
          renderCell: (item) => <MatchListExportLink disabled={actionsDisabled} item={item} />,
          width: "4.5rem",
        },
      ]}
      getRowKey={(item) => item.id}
      layout="fixed"
      minWidth="52rem"
      rows={items}
      verticalAlign="top"
    />
  );
}
