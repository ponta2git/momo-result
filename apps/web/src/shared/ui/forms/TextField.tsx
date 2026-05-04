import { useId } from "react";
import type { InputHTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";

export type TextFieldProps = {
  "aria-describedby"?: string | undefined;
  description?: string;
  error?: string;
  inputClassName?: string;
  label: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "aria-describedby">;

export function TextField({
  "aria-describedby": ariaDescribedBy,
  description,
  error,
  id,
  inputClassName,
  label,
  required,
  ...props
}: TextFieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;

  return (
    <Field
      description={description}
      descriptionId={descriptionId}
      error={error}
      errorId={errorId}
      htmlFor={fieldId}
      label={label}
      required={required}
    >
      <input
        {...props}
        className={cn(
          "min-h-10 w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 leading-6 text-[var(--color-text-primary)]",
          error ? "border-[var(--color-danger)]" : "",
          inputClassName,
        )}
        id={fieldId}
        required={required}
        aria-describedby={buildFieldDescribedBy(descriptionId, errorId, ariaDescribedBy)}
      />
    </Field>
  );
}
