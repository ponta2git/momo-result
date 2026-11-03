import { CalendarPlus } from "lucide-react";
import { useState } from "react";

import { parseHeldEventCreate } from "@/features/heldEvents/create/heldEventCreate";
import type { HeldEventCreateForm } from "@/features/heldEvents/create/heldEventCreate";
import { toLocalDateTimeInputValue } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TextField } from "@/shared/ui/forms/TextField";

const formId = "create-held-event";

export function CreateHeldEventDialog({ form }: { form: HeldEventCreateForm }) {
  const [draft, setDraft] = useState(() => ({
    version: form.formKey,
    heldAt: toLocalDateTimeInputValue(),
  }));
  if (draft.version !== form.formKey) {
    setDraft({ version: form.formKey, heldAt: toLocalDateTimeInputValue() });
  }
  const canSubmit = parseHeldEventCreate(draft.heldAt).kind === "ready";
  return (
    <Dialog
      busy={form.pending}
      description="開催日時を決めると、試合をまとめて記録・閲覧する場所ができます。"
      footer={
        // The footer sits outside the form, so the submit button names its form and pending state.
        <DialogFooter>
          <Button disabled={form.pending} variant="secondary" onClick={form.close}>
            キャンセル
          </Button>
          <Button
            disabled={!canSubmit}
            form={formId}
            icon={<CalendarPlus aria-hidden="true" />}
            pending={form.pending}
            pendingLabel="作成中…"
            type="submit"
          >
            開催を作成
          </Button>
        </DialogFooter>
      }
      open={form.open}
      title="新しい開催を作成"
      onOpenChange={(open) => {
        if (!open) form.close();
      }}
    >
      <form key={form.formKey} action={form.action} className="grid gap-4" id={formId}>
        <TextField
          required
          description="開催後も日時は一覧と開催詳細の見出しとして使います。"
          label="開催日時"
          name="heldAt"
          type="datetime-local"
          value={draft.heldAt}
          onChange={(event) => setDraft({ version: form.formKey, heldAt: event.target.value })}
        />
        {form.errorMessage ? (
          <Notice role="alert" tone="danger" title="開催を作成できません">
            {form.errorMessage}
          </Notice>
        ) : null}
      </form>
    </Dialog>
  );
}
