import { Button } from "@/shared/ui/actions/Button";

type MasterCreateFormProps = {
  actionLabel?: string;
  disabled?: boolean;
  disabledReason?: string | undefined;
  error?: string | undefined;
  isPending?: boolean;
  label: string;
  onSubmit: () => void;
  placeholder?: string;
  submitLabel?: string;
  value: string;
  onChange: (value: string) => void;
};

const inputClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]";
const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

export function MasterCreateForm({
  actionLabel = "追加",
  disabled = false,
  disabledReason,
  error,
  isPending = false,
  label,
  onSubmit,
  placeholder,
  submitLabel,
  value,
  onChange,
}: MasterCreateFormProps) {
  const canSubmit = value.trim().length > 0 && !disabled;

  return (
    <form
      className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) {
          return;
        }
        onSubmit();
      }}
    >
      <label className="grid gap-1">
        <span className={labelClass}>{label}</span>
        <input
          className={inputClass}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <Button
        pending={isPending}
        pendingLabel={submitLabel ? `${submitLabel}中` : `${actionLabel}中`}
        type="submit"
        variant="primary"
        disabled={!canSubmit}
      >
        {submitLabel ?? actionLabel}
      </Button>
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
