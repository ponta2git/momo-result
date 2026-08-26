import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { buildFieldDescribedBy } from "@/shared/ui/forms/Field";

export type CheckboxFieldProps = {
  description?: ReactNode | undefined;
  error?: ReactNode | undefined;
  fieldClassName?: string | undefined;
  label: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "aria-describedby" | "type">;

/** Associates one native checkbox with its visible label, help, error, and disabled state. */
export function CheckboxField({
  className,
  description,
  disabled,
  error,
  fieldClassName,
  id,
  label,
  required,
  ...props
}: CheckboxFieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;

  return (
    <div className={cn("min-w-0", fieldClassName)}>
      <label
        className={cn(
          "inline-flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-[var(--radius-xs)] px-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
          disabled ? "cursor-not-allowed opacity-65" : "",
        )}
        htmlFor={fieldId}
      >
        <input
          {...props}
          aria-describedby={buildFieldDescribedBy(descriptionId, errorId)}
          aria-invalid={error ? true : undefined}
          className={cn("size-4 shrink-0 accent-[var(--color-action)]", className)}
          disabled={disabled}
          id={fieldId}
          required={required}
          type="checkbox"
        />
        <span className="min-w-0 text-pretty">
          {label}
          {required ? <span className="ml-1 text-[var(--color-danger)]">*</span> : null}
        </span>
      </label>
      {description ? (
        <p
          className="momo-copy mt-1 pl-2 text-xs text-pretty text-[var(--color-text-secondary)]"
          id={descriptionId}
        >
          {description}
        </p>
      ) : null}
      {error ? (
        <p
          className="momo-copy mt-1 pl-2 text-xs text-pretty text-[var(--color-danger)]"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
