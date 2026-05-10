import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { layoutFamilies } from "@/shared/api/enums";
import type { LayoutFamily } from "@/shared/api/enums";
import { formatApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { AlertDialog, Dialog } from "@/shared/ui/feedback/Dialog";
import { Field } from "@/shared/ui/forms/Field";

const inputClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]";

type MasterEditDialogProps = {
  initialLayoutFamily?: LayoutFamily | string | undefined;
  initialName: string;
  label: string;
  onSave: (values: { name: string; layoutFamily?: string | undefined }) => Promise<void>;
  showLayoutFamily?: boolean | undefined;
  title: string;
};

export function MasterEditDialog({
  initialLayoutFamily,
  initialName,
  label,
  onSave,
  showLayoutFamily = false,
  title,
}: MasterEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={title}
      trigger={
        <IconButton
          aria-label={`${label}を編集`}
          icon={<Pencil />}
          size="sm"
          tooltip={`${label}を編集`}
          variant="quiet"
        />
      }
    >
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(undefined);
          setPending(true);
          const formData = new FormData(event.currentTarget);
          try {
            await onSave({
              name: String(formData.get("name") ?? ""),
              layoutFamily: showLayoutFamily
                ? String(formData.get("layoutFamily") ?? initialLayoutFamily ?? "")
                : undefined,
            });
            setOpen(false);
          } catch (caught) {
            setError(formatApiError(caught, `${label}の更新に失敗しました`));
          } finally {
            setPending(false);
          }
        }}
      >
        <Field label={`${label}名`}>
          <input className={inputClass} defaultValue={initialName} name="name" required />
        </Field>
        {showLayoutFamily ? (
          <Field label="Layout Family">
            <select
              className={inputClass}
              defaultValue={initialLayoutFamily ?? layoutFamilies[0]}
              name="layoutFamily"
            >
              {layoutFamilies.map((family) => (
                <option key={family} value={family}>
                  {family}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <Button disabled={pending} pending={pending} pendingLabel="保存中" type="submit">
          保存
        </Button>
      </form>
    </Dialog>
  );
}

type MasterDeleteDialogProps = {
  label: string;
  name: string;
  onDelete: () => void;
};

export function MasterDeleteDialog({ label, name, onDelete }: MasterDeleteDialogProps) {
  return (
    <AlertDialog
      title={`${label}を削除しますか？`}
      description={`${name} を削除します。試合や下書きから参照されている場合は削除できません。`}
      confirmLabel="削除"
      onConfirm={onDelete}
      trigger={
        <IconButton
          aria-label={`${label}を削除`}
          icon={<Trash2 />}
          size="sm"
          tooltip={`${label}を削除`}
          variant="quiet"
        />
      }
    />
  );
}
