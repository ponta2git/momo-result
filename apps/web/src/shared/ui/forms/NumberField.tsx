import { useId } from "react";
import type { InputHTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";

type NumberFieldWidth = "money" | "short";

const widthClass: Record<NumberFieldWidth, string> = {
  money: "min-w-[12ch]",
  short: "min-w-[6ch]",
};

export type NumberFieldProps = {
  "aria-describedby"?: string | undefined;
  description?: string;
  error?: string;
  label: string;
  unit?: string;
  width?: NumberFieldWidth;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "aria-describedby" | "type">;

export function NumberField({
  "aria-describedby": ariaDescribedBy,
  className,
  description,
  error,
  id,
  label,
  required,
  unit,
  width = "money",
  ...props
}: NumberFieldProps) {
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
      <div className="flex min-w-0 items-center gap-2">
        <input
          {...props}
          className={cn(
            "momo-ui-control momo-numeric min-h-10 px-3 py-2 text-[var(--color-text-primary)]",
            widthClass[width],
            error ? "border-[var(--color-danger)]" : "",
            className,
          )}
          id={fieldId}
          inputMode={props.inputMode ?? "numeric"}
          required={required}
          type="text"
          aria-describedby={buildFieldDescribedBy(descriptionId, errorId, ariaDescribedBy)}
        />
        {unit ? (
          <span
            className="shrink-0 text-xs leading-5 text-[var(--color-text-secondary)]"
            aria-hidden="true"
          >
            {unit}
          </span>
        ) : null}
      </div>
    </Field>
  );
}
