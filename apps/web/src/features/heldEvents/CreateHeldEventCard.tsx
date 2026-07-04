import { Plus } from "lucide-react";
import { useFormStatus } from "react-dom";

import type { HeldEventCreateFormModel } from "@/features/heldEvents/heldEventViewModel";
import { Button } from "@/shared/ui/actions/Button";
import { TextField } from "@/shared/ui/forms/TextField";
import { Card } from "@/shared/ui/layout/Card";

type CreateHeldEventCardProps = {
  model: HeldEventCreateFormModel;
};

export function CreateHeldEventCard({ model }: CreateHeldEventCardProps) {
  return (
    <form key={model.state.version} action={model.action}>
      <Card className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">開催回を追加</h2>
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
            必要な開催回が一覧にないときに追加します。
          </p>
        </div>
        <TextField
          label="開催日時"
          name="heldAt"
          type="datetime-local"
          value={model.heldAtDraft}
          onChange={(event) => {
            model.setHeldAtDraft(event.target.value);
          }}
        />
        <CreateHeldEventButton disabled={!model.heldAtDraft} />
      </Card>
    </form>
  );
}

function CreateHeldEventButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      disabled={disabled}
      icon={<Plus className="size-4" />}
      pending={pending}
      pendingLabel="作成中…"
      type="submit"
    >
      開催履歴を作成
    </Button>
  );
}
