import { useMatchAchievementFields } from "@/features/matches/workspace/useMatchAchievementFields";
import type { MatchAchievementFieldsProps } from "@/features/matches/workspace/useMatchAchievementFields";
import { achievementPageHref } from "@/shared/achievements/achievementPresentation";
import type { AchievementItem } from "@/shared/api/achievements";
import { canonicalResultMembers, memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { CheckboxField } from "@/shared/ui/forms/CheckboxField";
import { contentText } from "@/shared/ui/typography";

export function MatchAchievementFields({
  setup,
  values,
  disabled,
  onChange,
}: MatchAchievementFieldsProps) {
  const {
    open,
    setOpen,
    loading,
    refreshing,
    failed,
    hasCatalog,
    refresh,
    items,
    directClaim,
    isSelected,
    outdated,
    remove,
    add,
  } = useMatchAchievementFields({ setup, values, disabled, onChange });
  return (
    <section aria-label="今回記録する実績" className="min-w-0">
      <Disclosure
        summary={`実績を記録（任意）${values.length > 0 ? `・入力${values.length}件` : ""}`}
        ariaLabel="試合と一緒に実績を記録"
        panelSpacing="sm"
        open={open}
        onOpenChange={setOpen}
      >
        <div className="grid min-w-0 gap-4">
          <p className={contentText.supporting}>
            達成した実績とプレーヤーを選んでください。試合結果から判定できる実績は自動で記録されます。
          </p>
          {!setup.gameTitleId || !setup.mapMasterId ? (
            <p className={contentText.body}>作品とマップを選ぶと対象の実績を表示します。</p>
          ) : null}
          {loading ? <Skeleton className="h-28" /> : null}
          {failed ? (
            <Notice
              tone="warning"
              title="実績の入力候補を取得できません"
              action={
                <Button size="sm" variant="secondary" pending={refreshing} onClick={refresh}>
                  候補を再読み込み
                </Button>
              }
            >
              今回の実績を入力しなければ試合結果だけを保存できます。入力済みの実績は保持しています。
            </Notice>
          ) : null}
          {outdated.length > 0 ? (
            <Notice tone="warning" title="選択した実績を確認してください">
              <p>
                作品・マップ、または保存済みの実績が変わりました。入力を外すか、最新内容で選び直してください。
              </p>
              <ul className="mt-2 grid gap-2">
                {outdated.map(({ selection: entry, currentItem }) => (
                  <li
                    key={`${entry.achievementId}:${entry.memberId}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span>
                      {entry.achievementName}・{memberDisplayName(entry.memberId)}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => remove(entry.achievementId, entry.memberId)}
                    >
                      入力を外す
                    </Button>
                    {currentItem ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={disabled}
                        onClick={() => add(currentItem, entry.memberId)}
                      >
                        最新内容で選び直す
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {hasCatalog && setup.mapMasterId ? (
            <DataTable
              caption={{ content: "手入力で記録する実績" }}
              columns={[
                {
                  key: "item",
                  header: "実績",
                  rowHeader: true,
                  minWidth: "14rem",
                  renderCell: (item) => (
                    <div className="grid gap-1">
                      <p className="text-pretty">{item.name}</p>
                      {item.notes ? (
                        <p className={cn(contentText.supporting, "text-pretty")}>{item.notes}</p>
                      ) : null}
                    </div>
                  ),
                },
                ...canonicalResultMembers.map((member) => ({
                  key: member.memberId,
                  header: member.displayName,
                  minWidth: "5rem",
                  renderCell: (item: AchievementItem) => {
                    const selected = isSelected(item.achievementId, member.memberId);
                    const saved = directClaim(item.achievementId, member.memberId);
                    return saved?.state === "achieved" && !selected ? (
                      <LinkButton
                        size="sm"
                        variant="quiet"
                        to={achievementPageHref(
                          setup.gameTitleId,
                          item.achievementId,
                          member.memberId,
                        )}
                        aria-label={`${item.name}・${member.displayName}の保存済み実績を見る`}
                      >
                        達成済み
                      </LinkButton>
                    ) : (
                      <CheckboxField
                        label={
                          <span className="sr-only">
                            {item.name}・{member.displayName}
                          </span>
                        }
                        checked={selected}
                        disabled={disabled}
                        onChange={(event) => {
                          if (event.target.checked) add(item, member.memberId);
                          else remove(item.achievementId, member.memberId);
                        }}
                      />
                    );
                  },
                })),
              ]}
              rows={items}
              getRowKey={(item) => item.achievementId}
              density="compact"
              stickyRowHeader
              verticalAlign="top"
              emptyState={<p>この試合で入力する実績はありません。</p>}
            />
          ) : null}
        </div>
      </Disclosure>
    </section>
  );
}
