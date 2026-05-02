import { useId } from "react";
import type { SelectHTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";

type SelectOption = {
  disabled?: boolean | undefined;
  label: string;
  value: string;
};

export type SelectFieldProps = {
  "aria-describedby"?: string | undefined;
  description?: string;
  error?: string;
  label: string;
  options: SelectOption[];
  selectClassName?: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "aria-describedby" | "children">;

export function SelectField({
  "aria-describedby": ariaDescribedBy,
  description,
  error,
  id,
  label,
  options,
  required,
  selectClassName,
  ...props
}: SelectFieldProps) {
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
      <select
        {...props}
        className={cn(
          "momo-ui-control min-h-10 px-3 py-2 leading-6 text-[var(--color-text-primary)]",
          error ? "border-[var(--color-danger)]" : "",
          selectClassName,
        )}
        id={fieldId}
        required={required}
        aria-describedby={buildFieldDescribedBy(descriptionId, errorId, ariaDescribedBy)}
      >
        {options.map((option) => (
          <option key={option.value} disabled={option.disabled} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
