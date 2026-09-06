import { useCallback } from "react";

import { formatMatchDetailDate } from "@/features/matches/matchDetailViewModel";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { formatApiError } from "@/shared/api/problemDetails";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { FactList } from "@/shared/ui/data/FactList";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText } from "@/shared/ui/typography";

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
    <section aria-labelledby="match-record-metadata-heading" className="grid gap-4">
      {errorMessage && !showConfirm ? (
        <Notice tone="danger" title="削除に失敗しました">
          {errorMessage}
        </Notice>
      ) : null}
      <ContentWithActions
        actions={
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
        }
      >
        <div className="grid min-w-0 gap-2">
          <h2 className={contentText.heading} id="match-record-metadata-heading">
            記録情報
          </h2>
          <FactList
            ariaLabel="試合の記録情報"
            columns={3}
            items={[
              { id: "owner", label: "オーナー", value: memberDisplayName(match.ownerMemberId) },
              { id: "playedAt", label: "対戦日時", value: formatMatchDetailDate(match.playedAt) },
              { id: "createdAt", label: "確定日時", value: formatMatchDetailDate(match.createdAt) },
            ]}
            layout="plain"
          />
        </div>
      </ContentWithActions>
    </section>
  );
}
