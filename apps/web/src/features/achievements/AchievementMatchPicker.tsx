import { useAchievementMatchPicker } from "@/features/achievements/useAchievementMatchPicker";
import type { AchievementItem } from "@/shared/api/achievements";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
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
  const { setCursor, matches, pagination } = useAchievementMatchPicker(item);
  return (
    <div className="grid gap-4">
      {matches.isError ? (
        <Notice
          tone="danger"
          title="試合を取得できません"
          action={
            <Button
              size="sm"
              variant="secondary"
              pending={matches.isFetching}
              onClick={() => void matches.refetch()}
            >
              再読み込み
            </Button>
          }
        >
          通信状態を確認して再試行してください。
        </Notice>
      ) : null}
      {matches.isLoading ? <Skeleton className="h-32" /> : null}
      <ul className="grid gap-4">
        {(matches.data?.items ?? []).map((match) => {
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
                    disabled={disabled || !eligible || !id || matches.isPlaceholderData}
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
      {matches.data?.items?.length === 0 ? (
        <p className={contentText.body}>確定済みの試合はありません。</p>
      ) : null}
      {pagination ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!pagination.hasPreviousPage || matches.isFetching}
            onClick={() => setCursor(pagination.previousCursor)}
          >
            前へ
          </Button>
          <span className={cn(contentText.supporting, "tabular-nums")}>
            {pagination.page}／{Math.max(1, pagination.totalPages)}ページ
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!pagination.hasNextPage || matches.isFetching}
            onClick={() => setCursor(pagination.nextCursor)}
          >
            次へ
          </Button>
        </div>
      ) : null}
    </div>
  );
}
