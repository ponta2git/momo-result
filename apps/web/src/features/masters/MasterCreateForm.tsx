import { Button } from "@/shared/ui/actions/Button";
import { TextField } from "@/shared/ui/forms/TextField";

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
    <form action={action} className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end" key={formKey}>
      <TextField
        description={error ? undefined : disabledReason}
        disabled={disabled}
        error={error}
        label={label}
        name={inputName}
        placeholder={placeholder}
        type="text"
      />
      <Button disabled={disabled} pendingLabel={pendingLabel} type="submit" variant="primary">
        {buttonLabel}
      </Button>
    </form>
  );
}
