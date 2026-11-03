import { Trash2 } from "lucide-react";

import { useWorkspacePersistenceControls } from "@/features/matches/workspace/MatchWorkspacePersistence";
import { formatApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";

/** Deleting the draft acts on the whole record, so it sits on the page row, not in a section. */
export function MatchWorkspaceCancellationAction() {
  const { cancellation } = useWorkspacePersistenceControls().persistence;
  if (!cancellation.allowed) return null;
  return (
    <AlertDialog
      cancelLabel="キャンセル"
      confirmLabel="削除する"
      pendingLabel="削除中…"
      formatError={(error) => formatApiError(error, "確定前の記録を削除できませんでした")}
      description="この確定前の記録を削除します。元に戻せません。"
      open={cancellation.dialog.open}
      pending={cancellation.dialog.pending}
      title="確定前の記録を削除しますか？"
      trigger={
        <Button
          disabled={cancellation.disabled}
          icon={<Trash2 aria-hidden="true" />}
          size="sm"
          variant="dangerQuiet"
          onClick={cancellation.onTrigger}
        >
          確定前の記録を削除
        </Button>
      }
      onConfirm={cancellation.dialog.onConfirm}
      onOpenChange={cancellation.dialog.onOpenChange}
    />
  );
}

/** A failure stays on the page after the dialog closes, below the row that holds the action. */
export function MatchWorkspaceCancellationError() {
  const { cancellation } = useWorkspacePersistenceControls().persistence;
  if (!cancellation.error || cancellation.dialog.open) return null;
  return (
    <Notice title={cancellation.error.title} tone="danger">
      <div className="grid gap-1">
        <p>{cancellation.error.detail}</p>
        <p>{cancellation.error.nextStep}</p>
      </div>
    </Notice>
  );
}
