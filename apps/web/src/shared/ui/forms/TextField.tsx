import { useId } from "react";

import { InputControl } from "@/shared/ui/forms/Control";
import type { InputControlProps } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";
import type { FieldLayout } from "@/shared/ui/forms/Field";

export type TextFieldProps = {
  "aria-describedby"?: string | undefined;
  description?: string | undefined;
  error?: string | undefined;
  label: string;
  layout?: FieldLayout | undefined;
} & Omit<InputControlProps, "aria-describedby" | "className" | "invalid">;

export function TextField({
  "aria-describedby": ariaDescribedBy,
  description,
  error,
  id,
  label,
  layout,
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
      layout={layout}
      required={required}
    >
      <InputControl
        {...props}
        id={fieldId}
        invalid={Boolean(error)}
        required={required}
        aria-describedby={buildFieldDescribedBy(descriptionId, errorId, ariaDescribedBy)}
      />
    </Field>
  );
}
