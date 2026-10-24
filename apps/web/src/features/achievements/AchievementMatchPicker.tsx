import { useAchievementMatchPicker } from "@/features/achievements/useAchievementMatchPicker";
import { achievementJapanDate } from "@/shared/achievements/achievementDates";
import type { AchievementItem } from "@/shared/api/achievements";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
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
    <div className="grid gap-3">
      <p className={contentText.supporting}>
        古い試合から表示しています。対象マップ・適用開始日に合う試合を選んでください。
      </p>
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
      <ul className="grid gap-2">
        {(matches.data?.items ?? []).map((match) => {
          const id = match.matchId;
          const day = match.playedAt ? achievementJapanDate(match.playedAt) : null;
          const eligible = Boolean(
            id &&
            day &&
            (item.common || (match.mapMasterId && item.mapMasterIds.includes(match.mapMasterId))) &&
            (!item.appliesFrom || day >= item.appliesFrom),
          );
          return (
            <li key={match.id} className="flex flex-wrap items-center justify-between gap-2">
              <div className="grid gap-1">
                <span className={cn(contentText.body, "tabular-nums")}>
                  {formatDateTimeLong(match.playedAt)}・第{match.matchNoInEvent}試合
                </span>
                <span className={contentText.supporting}>
                  {match.mapName ?? "マップ未取得"}
                  {!eligible ? "・対象外" : ""}
                </span>
              </div>
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
