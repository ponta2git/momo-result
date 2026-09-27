import { useId } from "react";
import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { buildFieldDescribedBy } from "@/shared/ui/forms/Field";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";
import { fieldText } from "@/shared/ui/typography";

export type CheckboxFieldProps = {
  "aria-describedby"?: string | undefined;
  description?: ReactNode | undefined;
  error?: ReactNode | undefined;
  label: ReactNode;
  /** Noninteractive state beside the control, also included in its accessible description. */
  status?: ReactNode | undefined;
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
  status,
  ...props
}: CheckboxFieldProps) {
  const surfaceRef = useSurfaceFeedback<HTMLLabelElement>();
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const statusId = status ? `${fieldId}-status` : undefined;

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <label
          ref={surfaceRef}
          className={cn(
            "momo-surface momo-surface-press inline-flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-xs px-2 text-sm font-plain text-[var(--color-text-primary)]",
            disabled ? "cursor-not-allowed opacity-65" : "",
          )}
          htmlFor={fieldId}
        >
          <input
            {...props}
            aria-describedby={buildFieldDescribedBy(
              descriptionId,
              errorId,
              statusId,
              ariaDescribedBy,
            )}
            aria-invalid={error ? true : undefined}
            className="size-4 shrink-0 accent-[var(--color-action)]"
            disabled={disabled}
            id={fieldId}
            required={required}
            type="checkbox"
          />
          <span className="min-w-0 text-pretty">
            {label}
            {required ? (
              <span aria-hidden="true" className="ml-1 text-[var(--color-danger)]">
                *
              </span>
            ) : null}
          </span>
        </label>
        {status ? (
          <div className="min-w-0" id={statusId}>
            {status}
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex min-w-0 flex-col gap-1 pl-8 empty:hidden">
        {description ? (
          <p
            className={cn(fieldText.description, "text-pretty", readableTextWidthClass)}
            id={descriptionId}
          >
            {description}
          </p>
        ) : null}
        {error ? (
          <p
            className={cn(fieldText.error, "text-pretty", readableTextWidthClass)}
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
