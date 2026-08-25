import { useCallback } from "react";

import { formatMatchDetailDate } from "@/features/matches/matchDetailViewModel";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { formatApiError } from "@/shared/api/problemDetails";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Card } from "@/shared/ui/layout/Card";

export function MatchRecordMetadata({
  confirmDelete,
  errorMessage,
  isDeletePending,
  match,
  setShowConfirm,
  showConfirm,
}: {
  confirmDelete: () => Promise<void>;
  errorMessage: string | null;
  isDeletePending: boolean;
  match: MatchDetailResponse;
  setShowConfirm: (show: boolean) => void;
  showConfirm: boolean;
}) {
  const openDeleteDialog = useCallback(() => {
    setShowConfirm(true);
  }, [setShowConfirm]);
  const handleDeleteConfirm = useCallback(async () => {
    await confirmDelete();
  }, [confirmDelete]);

  return (
    <Card className="grid gap-4">
      {errorMessage && !showConfirm ? (
        <Notice tone="danger" title="削除に失敗しました">
          {errorMessage}
        </Notice>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">記録情報</h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            この結果の管理情報です。
          </p>
        </div>
        <AlertDialog
          cancelLabel="キャンセル"
          confirmLabel={isDeletePending ? "削除中…" : "削除する"}
          formatError={(error) => formatApiError(error, "削除に失敗しました")}
          pending={isDeletePending}
          description={`${formatMatchNoInEvent(match.matchNoInEvent)}を完全に削除します。この操作は取り消せません。`}
          open={showConfirm}
          title="試合を削除しますか？"
          trigger={
            <Button size="sm" variant="danger" onClick={openDeleteDialog}>
              削除
            </Button>
          }
          onConfirm={handleDeleteConfirm}
          onOpenChange={setShowConfirm}
        />
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">オーナー</dt>
          <dd className="mt-1">{memberDisplayName(match.ownerMemberId)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">対戦日時</dt>
          <dd className="mt-1 tabular-nums">{formatMatchDetailDate(match.playedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">確定日時</dt>
          <dd className="mt-1 tabular-nums">{formatMatchDetailDate(match.createdAt)}</dd>
        </div>
      </dl>
    </Card>
  );
}
