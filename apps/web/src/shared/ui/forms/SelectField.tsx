import { useId } from "react";
import type { SelectHTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";
import { fieldControlClass, fieldErrorControlClass } from "@/shared/ui/forms/controlStyles";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";

type SelectOption = {
  disabled?: boolean | undefined;
  label: string;
  value: string;
};

export type SelectFieldProps = {
  "aria-describedby"?: string | undefined;
  description?: string | undefined;
  error?: string | undefined;
  fieldClassName?: string | undefined;
  label: string;
  options: SelectOption[];
  selectClassName?: string | undefined;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "aria-describedby" | "children">;

export function SelectField({
  "aria-describedby": ariaDescribedBy,
  description,
  error,
  fieldClassName,
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
      className={fieldClassName}
      htmlFor={fieldId}
      label={label}
      required={required}
    >
      <select
        {...props}
        className={cn(fieldControlClass, error ? fieldErrorControlClass : "", selectClassName)}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
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
