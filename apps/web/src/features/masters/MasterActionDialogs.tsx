import { Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { readMasterEditForm } from "@/features/masters/masterFormModel";
import { formatApiError } from "@/shared/api/problemDetails";
import { layoutFamilies, layoutFamilyLabels } from "@/shared/domain/ocr";
import type { LayoutFamily } from "@/shared/domain/ocr";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { AlertDialog, Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
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
  const editor = useMasterEditDialog({ initialLayoutFamily, label, onSave, showLayoutFamily });

  return (
    <Dialog
      busy={editor.pending}
      open={editor.open}
      onOpenChange={editor.setOpen}
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
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void editor.submit(new FormData(event.currentTarget));
        }}
      >
        <div className="grid gap-4">
          <TextField
            disabled={editor.pending}
            defaultValue={initialName}
            error={editor.error}
            label={`${label}名`}
            name="name"
            required
          />
          {showLayoutFamily ? (
            <SelectField
              disabled={editor.pending}
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
        </div>
        <DialogFooter>
          <Button
            disabled={editor.pending}
            variant="secondary"
            onClick={() => editor.setOpen(false)}
          >
            キャンセル
          </Button>
          <Button
            disabled={editor.pending}
            pending={editor.pending}
            pendingLabel="保存中"
            type="submit"
          >
            保存
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function useMasterEditDialog({
  initialLayoutFamily,
  label,
  onSave,
  showLayoutFamily,
}: Pick<MasterEditDialogProps, "initialLayoutFamily" | "label" | "onSave"> & {
  showLayoutFamily: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  return {
    open,
    error,
    pending,
    setOpen: (next: boolean) => {
      if (next) setError(undefined);
      setOpen(next);
    },
    submit: async (formData: FormData) => {
      if (submitting.current) return;
      submitting.current = true;
      setError(undefined);
      setPending(true);
      try {
        await onSave(readMasterEditForm(formData, showLayoutFamily, initialLayoutFamily));
        setOpen(false);
      } catch (caught) {
        setError(formatApiError(caught, `${label}の更新に失敗しました`));
      } finally {
        submitting.current = false;
        setPending(false);
      }
    },
  };
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
