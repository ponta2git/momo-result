import { useAchievementMatchPicker } from "@/features/achievements/useAchievementMatchPicker";
import type { AchievementItem } from "@/shared/api/achievements";
import { cursorForPage } from "@/shared/lib/cursorPagination";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText } from "@/shared/ui/typography";

export function AchievementMatchPicker({
  item,
  selectedId,
  disabled,
  onSelect,
}: {
  item: AchievementItem;
  selectedId: string;
  disabled: boolean;
  onSelect: (matchId: string) => void;
}) {
  const {
    items,
    empty,
    loading,
    refreshing,
    failed,
    showingPreviousPage,
    pagination,
    setCursor,
    refresh,
  } = useAchievementMatchPicker(item);
  return (
    <div className="grid gap-4">
      {failed ? (
        <Notice
          tone="danger"
          title="試合を取得できません"
          action={
            <Button size="sm" variant="secondary" pending={refreshing} onClick={refresh}>
              再読み込み
            </Button>
          }
        >
          通信状態を確認して再試行してください。
        </Notice>
      ) : null}
      {loading ? <Skeleton className="h-32" /> : null}
      <ul className="grid gap-4">
        {items.map((match) => {
          const id = match.matchId;
          const eligible = Boolean(
            id &&
            (item.common || (match.mapMasterId && item.mapMasterIds.includes(match.mapMasterId))),
          );
          return (
            <li key={match.id}>
              <ContentWithActions
                actions={
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled || !eligible || !id || showingPreviousPage}
                    onClick={() => {
                      if (id) onSelect(id);
                    }}
                  >
                    {selectedId === id ? "選択中" : "この試合を選ぶ"}
                  </Button>
                }
              >
                <div className="grid gap-1">
                  <span className={cn(contentText.body, "tabular-nums")}>
                    {formatDateTimeLong(match.playedAt)}・第{match.matchNoInEvent}試合
                  </span>
                  <span className={contentText.supporting}>
                    {match.mapName ?? "マップ未取得"}
                    {eligible ? "" : "・この実績の対象外"}
                  </span>
                </div>
              </ContentWithActions>
            </li>
          );
        })}
      </ul>
      {empty ? <p className={contentText.body}>確定済みの試合はありません。</p> : null}
      {pagination && pagination.totalPages > 1 ? (
        <PaginationControls
          ariaLabel="試合候補のページネーション"
          disabled={refreshing}
          pagination={pagination}
          placement="embedded"
          variant="compact"
          onPageChange={(page) => {
            const cursor = cursorForPage(pagination, page);
            // An empty cursor is the first page; an unknown edge leaves the page unchanged.
            if (cursor !== undefined) setCursor(cursor || undefined);
          }}
        />
      ) : null}
    </div>
  );
}
