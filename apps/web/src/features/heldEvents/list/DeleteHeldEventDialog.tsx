import type { HeldEventDeleteConfirmation } from "@/features/heldEvents/list/heldEventActions";
import { formatApiError } from "@/shared/api/problemDetails";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";

type DeleteHeldEventDialogProps = {
  confirmation: HeldEventDeleteConfirmation;
};

export function DeleteHeldEventDialog({ confirmation }: DeleteHeldEventDialogProps) {
  if (!confirmation.target) {
    return null;
  }

  return (
    <AlertDialog
      cancelLabel="キャンセル"
      confirmLabel="削除する"
      pendingLabel="削除中…"
      pending={confirmation.pending}
      formatError={(error) => formatApiError(error, "開催の削除に失敗しました")}
      description={`${formatDateTimeLong(confirmation.target.heldAt)}の開催を削除します。この操作は取り消せません。`}
      open
      title="開催を削除しますか？"
      onConfirm={confirmation.confirm}
      onOpenChange={(open) => {
        if (!open) {
          confirmation.cancel();
        }
      }}
    />
  );
}
