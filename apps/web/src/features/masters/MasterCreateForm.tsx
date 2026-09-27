import { startTransition, useState } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { TextField } from "@/shared/ui/forms/TextField";

type MasterCreateFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  actionLabel?: string;
  disabled?: boolean;
  disabledReason?: string | undefined;
  error?: string | undefined;
  formKey?: string | number | undefined;
  scopeKey: string;
  inputName?: string;
  label: string;
  pending?: boolean | undefined;
  placeholder?: string;
  submitLabel?: string;
};

export function MasterCreateForm({
  action,
  actionLabel = "追加",
  disabled = false,
  disabledReason,
  error,
  formKey,
  scopeKey,
  inputName = "name",
  label,
  pending = false,
  placeholder,
  submitLabel,
}: MasterCreateFormProps) {
  const buttonLabel = submitLabel ?? actionLabel;
  const pendingLabel = submitLabel ? `${submitLabel}中` : `${actionLabel}中`;
  const [drafts, setDrafts] = useState<Record<string, { value: string; version: typeof formKey }>>(
    {},
  );
  const draft = drafts[scopeKey];
  const value = draft && draft.version === formKey ? draft.value : "";

  return (
    <form
      className="grid gap-x-2 gap-y-2 md:grid-cols-[1fr_auto] md:grid-rows-[auto_auto_auto] md:gap-y-0 md:[&>[data-field-root]]:row-span-3"
      key={formKey}
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || pending) return;
        const data = new FormData(event.currentTarget);
        // Error Actions resolve too; reset only when success advances formKey.
        startTransition(() => action(data));
      }}
    >
      <TextField
        description={error ? undefined : disabledReason}
        disabled={disabled || pending}
        error={error}
        label={label}
        layout="subgrid"
        name={inputName}
        placeholder={placeholder}
        type="text"
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDrafts((current) => ({
            ...current,
            [scopeKey]: { value: nextValue, version: formKey },
          }));
        }}
      />
      <div className="grid md:col-start-2 md:row-start-2">
        <Button
          disabled={disabled}
          pending={pending}
          pendingLabel={pendingLabel}
          type="submit"
          variant="secondary"
        >
          {buttonLabel}
        </Button>
      </div>
    </form>
  );
}
