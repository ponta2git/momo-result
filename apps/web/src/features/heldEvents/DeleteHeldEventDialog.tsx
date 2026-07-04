import { formatDateTime } from "@/features/heldEvents/heldEventViewModel";
import type { HeldEventsPageController } from "@/features/heldEvents/useHeldEventsPageController";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";

type DeleteHeldEventDialogProps = {
  deleteMutation: HeldEventsPageController["deleteMutation"];
  deleteTarget: HeldEventsPageController["deleteTarget"];
  setDeleteTarget: HeldEventsPageController["setDeleteTarget"];
};

export function DeleteHeldEventDialog({
  deleteMutation,
  deleteTarget,
  setDeleteTarget,
}: DeleteHeldEventDialogProps) {
  if (!deleteTarget) {
    return null;
  }

  return (
    <AlertDialog
      cancelLabel="キャンセル"
      confirmLabel={deleteMutation.isPending ? "削除中…" : "削除する"}
      pending={deleteMutation.isPending}
      description={`${formatDateTime(deleteTarget.heldAt)} の開催履歴を削除します。この操作は取り消せません。`}
      open
      title="開催履歴を削除しますか？"
      onConfirm={async () => {
        await deleteMutation.mutateAsync(deleteTarget);
      }}
      onOpenChange={(open) => {
        if (!open) {
          setDeleteTarget(null);
        }
      }}
    />
  );
}
