import { useId } from "react";

import { InputControl } from "@/shared/ui/forms/Control";
import type { InputControlProps } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";

export type TextFieldProps = {
  "aria-describedby"?: string | undefined;
  description?: string | undefined;
  error?: string | undefined;
  fieldClassName?: string | undefined;
  inputClassName?: string | undefined;
  label: string;
} & Omit<InputControlProps, "aria-describedby" | "className" | "invalid">;

export function TextField({
  "aria-describedby": ariaDescribedBy,
  description,
  error,
  fieldClassName,
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
      className={fieldClassName}
      htmlFor={fieldId}
      label={label}
      required={required}
    >
      <InputControl
        {...props}
        className={inputClassName}
        id={fieldId}
        invalid={Boolean(error)}
        required={required}
        aria-describedby={buildFieldDescribedBy(descriptionId, errorId, ariaDescribedBy)}
      />
    </Field>
  );
}
