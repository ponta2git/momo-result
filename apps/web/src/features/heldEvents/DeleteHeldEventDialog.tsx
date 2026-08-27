import { formatDateTime } from "@/features/heldEvents/heldEventViewModel";
import type { HeldEventDeleteDialogModel } from "@/features/heldEvents/heldEventViewModel";
import { formatApiError } from "@/shared/api/problemDetails";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";

type DeleteHeldEventDialogProps = {
  model: HeldEventDeleteDialogModel;
};

export function DeleteHeldEventDialog({ model }: DeleteHeldEventDialogProps) {
  if (!model.target) {
    return null;
  }

  return (
    <AlertDialog
      cancelLabel="キャンセル"
      confirmLabel={model.pending ? "削除中…" : "削除する"}
      pending={model.pending}
      formatError={(error) => formatApiError(error, "開催の削除に失敗しました")}
      description={`${formatDateTime(model.target.heldAt)}の開催を削除します。この操作は取り消せません。`}
      open
      title="開催を削除しますか？"
      onConfirm={async () => {
        if (model.target) {
          await model.confirm(model.target);
        }
      }}
      onOpenChange={(open) => {
        if (!open) {
          model.cancel();
        }
      }}
    />
  );
}
