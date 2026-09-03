import { useId } from "react";
import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { buildFieldDescribedBy } from "@/shared/ui/forms/Field";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";

export type CheckboxFieldProps = {
  "aria-describedby"?: string | undefined;
  description?: ReactNode | undefined;
  error?: ReactNode | undefined;
  label: ReactNode;
} & Omit<
  ComponentPropsWithRef<"input">,
  "aria-describedby" | "aria-invalid" | "className" | "style" | "type"
>;

/** Associates one native checkbox with its visible label, help, error, and disabled state. */
export function CheckboxField({
  "aria-describedby": ariaDescribedBy,
  description,
  disabled,
  error,
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
    <div className="min-w-0">
      <label
        className={cn(
          "inline-flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-xs px-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
          disabled ? "cursor-not-allowed opacity-65" : "",
        )}
        data-field-control=""
        htmlFor={fieldId}
      >
        <input
          {...props}
          aria-describedby={buildFieldDescribedBy(descriptionId, errorId, ariaDescribedBy)}
          aria-invalid={error ? true : undefined}
          className="size-4 shrink-0 accent-[var(--color-action)]"
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
      <div className="mt-1 flex min-w-0 flex-col gap-1 pl-8 empty:hidden" data-field-support="">
        {description ? (
          <p
            className={cn(
              "momo-copy text-xs text-pretty text-[var(--color-text-secondary)]",
              readableTextWidthClass,
            )}
            id={descriptionId}
          >
            {description}
          </p>
        ) : null}
        {error ? (
          <p
            className={cn(
              "momo-copy text-xs text-pretty text-[var(--color-danger)]",
              readableTextWidthClass,
            )}
            id={errorId}
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
