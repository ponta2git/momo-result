import { useFormStatus } from "react-dom";

import { Button } from "@/shared/ui/actions/Button";

type MasterCreateFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  actionLabel?: string;
  disabled?: boolean;
  disabledReason?: string | undefined;
  error?: string | undefined;
  formKey?: string | number | undefined;
  inputName?: string;
  label: string;
  placeholder?: string;
  submitLabel?: string;
};

const inputClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]";
const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

function SubmitButton({
  disabled,
  label,
  pendingLabel,
}: {
  disabled: boolean;
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      disabled={disabled || pending}
      pending={pending}
      pendingLabel={pendingLabel}
      type="submit"
      variant="primary"
    >
      {label}
    </Button>
  );
}

export function MasterCreateForm({
  action,
  actionLabel = "追加",
  disabled = false,
  disabledReason,
  error,
  formKey,
  inputName = "name",
  label,
  placeholder,
  submitLabel,
}: MasterCreateFormProps) {
  const buttonLabel = submitLabel ?? actionLabel;
  const pendingLabel = submitLabel ? `${submitLabel}中` : `${actionLabel}中`;

  return (
    <form
      action={action}
      className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end"
      key={formKey}
    >
      <label className="grid gap-1">
        <span className={labelClass}>{label}</span>
        <input
          className={inputClass}
          disabled={disabled}
          name={inputName}
          placeholder={placeholder}
          type="text"
        />
      </label>
      <SubmitButton disabled={disabled} label={buttonLabel} pendingLabel={pendingLabel} />
      {error ? (
        <p className="text-sm text-[var(--color-danger)] md:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
      {!error && disabledReason ? (
        <p className="text-sm text-[var(--color-text-secondary)] md:col-span-2">{disabledReason}</p>
      ) : null}
    </form>
  );
}
