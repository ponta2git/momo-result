import { useId } from "react";

import { SelectControl } from "@/shared/ui/forms/Control";
import type { SelectControlProps } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";
import type { FieldLayout } from "@/shared/ui/forms/Field";

type SelectOption = {
  disabled?: boolean | undefined;
  label: string;
  value: string;
};

export type SelectFieldProps = {
  "aria-describedby"?: string | undefined;
  description?: string | undefined;
  error?: string | undefined;
  label: string;
  layout?: FieldLayout | undefined;
  options: SelectOption[];
} & Omit<SelectControlProps, "aria-describedby" | "children" | "className" | "invalid">;

export function SelectField({
  "aria-describedby": ariaDescribedBy,
  description,
  error,
  id,
  label,
  layout,
  options,
  required,
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
      layout={layout}
      required={required}
    >
      <SelectControl
        {...props}
        id={fieldId}
        invalid={Boolean(error)}
        required={required}
        aria-describedby={buildFieldDescribedBy(descriptionId, errorId, ariaDescribedBy)}
      >
        {options.map((option) => (
          <option key={option.value} disabled={option.disabled} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectControl>
    </Field>
  );
}
