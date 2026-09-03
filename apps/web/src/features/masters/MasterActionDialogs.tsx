import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { layoutFamilies, layoutFamilyLabels } from "@/shared/api/enums";
import type { LayoutFamily } from "@/shared/api/enums";
import { formatApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { AlertDialog, Dialog } from "@/shared/ui/feedback/Dialog";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

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
      busy={pending}
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
        className="grid gap-4"
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
        <TextField
          defaultValue={initialName}
          error={error}
          label={`${label}名`}
          name="name"
          required
        />
        {showLayoutFamily ? (
          <SelectField
            label="読み取り方式"
            description="作品ごとの画面構造に合わせて、読み取り方を切り替えます。"
            defaultValue={initialLayoutFamily ?? layoutFamilies[0]}
            name="layoutFamily"
            options={layoutFamilies.map((family) => ({
              label: layoutFamilyLabels[family],
              value: family,
            }))}
          />
        ) : null}
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
  onDelete: () => Promise<void> | void;
};

export function MasterDeleteDialog({ label, name, onDelete }: MasterDeleteDialogProps) {
  return (
    <AlertDialog
      title={`${label}を削除しますか？`}
      description={`${name} を削除します。試合や確定前の記録から参照されている場合は削除できません。`}
      confirmLabel="削除"
      formatError={(error) => formatApiError(error, `${label}の削除に失敗しました`)}
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
