import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { createHeldEventRequest } from "@/features/heldEvents/heldEventViewModel";
import type { HeldEventCreateFormModel } from "@/features/heldEvents/heldEventViewModel";
import { toLocalDateTimeInputValue } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TextField } from "@/shared/ui/forms/TextField";

export function CreateHeldEventDialog({ model }: { model: HeldEventCreateFormModel }) {
  const [draft, setDraft] = useState(() => ({
    version: model.formKey,
    heldAt: toLocalDateTimeInputValue(),
  }));
  if (draft.version !== model.formKey) {
    setDraft({ version: model.formKey, heldAt: toLocalDateTimeInputValue() });
  }
  const canSubmit = createHeldEventRequest(draft.heldAt).kind === "ready";
  return (
    <Dialog
      busy={model.pending}
      description="開催日時を決めると、試合をまとめて記録・閲覧する場所ができます。"
      open={model.open}
      title="新しい開催を作成"
      onOpenChange={(open) => {
        if (!open) model.close();
      }}
    >
      <form key={model.formKey} action={model.action} className="grid gap-4">
        {model.errorMessage ? (
          <Notice role="alert" tone="danger" title="開催を作成できません">
            {model.errorMessage}
          </Notice>
        ) : null}
        <TextField
          required
          description="開催後も日時は一覧と開催詳細の見出しとして使います。"
          label="開催日時"
          name="heldAt"
          type="datetime-local"
          value={draft.heldAt}
          onChange={(event) => setDraft({ version: model.formKey, heldAt: event.target.value })}
        />
        <CreateHeldEventDialogActions canSubmit={canSubmit} close={model.close} />
      </form>
    </Dialog>
  );
}

function CreateHeldEventDialogActions({
  canSubmit,
  close,
}: {
  canSubmit: boolean;
  close: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <DialogFooter>
      <Button disabled={pending} variant="secondary" onClick={close}>
        キャンセル
      </Button>
      <Button
        disabled={!canSubmit}
        icon={<CalendarPlus aria-hidden="true" />}
        pendingLabel="作成中…"
        type="submit"
      >
        開催を作成
      </Button>
    </DialogFooter>
  );
}
