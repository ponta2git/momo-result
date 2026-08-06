import { useId } from "react";
import type { InputHTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";
import { fieldControlClass, fieldErrorControlClass } from "@/shared/ui/forms/controlStyles";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";

export type TextFieldProps = {
  "aria-describedby"?: string | undefined;
  description?: string | undefined;
  error?: string | undefined;
  fieldClassName?: string | undefined;
  inputClassName?: string | undefined;
  label: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "aria-describedby">;

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
      <input
        {...props}
        className={cn(fieldControlClass, error ? fieldErrorControlClass : "", inputClassName)}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={buildFieldDescribedBy(descriptionId, errorId, ariaDescribedBy)}
      />
    </Field>
  );
}
