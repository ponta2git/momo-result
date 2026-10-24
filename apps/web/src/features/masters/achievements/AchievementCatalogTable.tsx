import { achievementPageHref } from "@/shared/achievements/achievementPresentation";
import type { AchievementCatalog, AchievementItem } from "@/shared/api/achievements";
import { canonicalResultMembers } from "@/shared/domain/members";
import { formatDecimal, formatManYen } from "@/shared/lib/formatters";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { DataTable } from "@/shared/ui/data/DataTable";
import { contentText } from "@/shared/ui/typography";

function ruleLabel(item: AchievementItem) {
  const threshold = Number(item.threshold);
  switch (item.ruleKind) {
    case "total_assets":
      return `総資産${formatManYen(threshold)}以上`;
    case "destination":
      return `目的地到着${formatDecimal(threshold)}回以上`;
    case "suri_no_ginji":
      return `スリの銀次${formatDecimal(threshold)}回以上`;
    case "event_average_rank":
      return `1開催4試合で平均${formatDecimal(threshold)}位以内`;
    default:
      return "手入力";
  }
}

export function AchievementCatalogTable({
  items,
  maps,
  disabled,
  retired = false,
  onEdit,
  onRetire,
}: {
  items: AchievementItem[];
  maps: AchievementCatalog["maps"];
  disabled: boolean;
  retired?: boolean;
  onEdit: (item: AchievementItem) => void;
  onRetire: (item: AchievementItem) => void;
}) {
  return (
    <DataTable
      caption={{ content: retired ? "廃止した実績項目" : "実績項目の管理" }}
      columns={[
        {
          key: "name",
          header: "達成内容",
          rowHeader: true,
          minWidth: "15rem",
          renderCell: (item) => (
            <div className="grid gap-1">
              <p>{item.name}</p>
              {item.notes ? <p className={contentText.supporting}>{item.notes}</p> : null}
            </div>
          ),
        },
        {
          key: "scope",
          header: "対象マップ",
          minWidth: "8rem",
          renderCell: (item) =>
            item.common
              ? "共通"
              : item.mapMasterIds
                  .map((id) => maps.find((map) => map.mapMasterId === id)?.displayName ?? "マップ")
                  .join("・"),
        },
        {
          key: "stars",
          header: "難易度",
          renderCell: (item) => (
            <span aria-label={`星${item.stars}`}>{"★".repeat(item.stars)}</span>
          ),
        },
        {
          key: "rule",
          header: "判定",
          minWidth: "10rem",
          renderCell: ruleLabel,
        },
        ...(retired
          ? [
              {
                key: "records",
                header: "達成記録",
                minWidth: "14rem",
                renderCell: (item: AchievementItem) => (
                  <div className="flex flex-wrap gap-2">
                    {canonicalResultMembers.map((member) => (
                      <LinkButton
                        key={member.memberId}
                        size="sm"
                        variant="quiet"
                        to={achievementPageHref(
                          item.gameTitleId,
                          item.achievementId,
                          member.memberId,
                        )}
                        aria-label={`${item.name}・${member.displayName}の達成記録を開く`}
                      >
                        {member.displayName}
                      </LinkButton>
                    ))}
                  </div>
                ),
              },
            ]
          : [
              {
                key: "actions",
                header: "操作",
                renderCell: (item: AchievementItem) => (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => onEdit(item)}
                      aria-label={`${item.name}を編集`}
                    >
                      編集
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={disabled}
                      onClick={() => onRetire(item)}
                      aria-label={`${item.name}を廃止`}
                    >
                      廃止
                    </Button>
                  </div>
                ),
              },
            ]),
      ]}
      rows={items}
      getRowKey={(item) => item.achievementId}
      verticalAlign="top"
      emptyState={<p>実績項目はまだありません。</p>}
    />
  );
}
