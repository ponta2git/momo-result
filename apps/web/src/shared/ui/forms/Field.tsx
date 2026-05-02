import { useId } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

export type FieldProps = {
  children: ReactNode;
  className?: string | undefined;
  description?: ReactNode | undefined;
  descriptionId?: string | undefined;
  error?: ReactNode | undefined;
  errorId?: string | undefined;
  htmlFor?: string | undefined;
  label: ReactNode;
  labelClassName?: string | undefined;
  required?: boolean | undefined;
} & HTMLAttributes<HTMLDivElement>;

export function Field({
  children,
  className,
  description,
  descriptionId,
  error,
  errorId,
  htmlFor,
  label,
  labelClassName,
  required,
  ...props
}: FieldProps) {
  const fallbackId = useId();
  const resolvedDescriptionId = description
    ? (descriptionId ?? `${fallbackId}-description`)
    : undefined;
  const resolvedErrorId = error ? (errorId ?? `${fallbackId}-error`) : undefined;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} {...props}>
      <label
        className={cn("text-sm font-semibold text-[var(--color-text-primary)]", labelClassName)}
        htmlFor={htmlFor}
      >
        {label}
        {required ? <span className="ml-1 text-[var(--color-danger)]">*</span> : null}
      </label>
      {children}
      {description ? (
        <p
          id={resolvedDescriptionId}
          className="min-w-0 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]"
        >
          {description}
        </p>
      ) : null}
      {error ? (
        <p
          id={resolvedErrorId}
          className="min-w-0 text-xs leading-5 text-pretty text-[var(--color-danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function buildFieldDescribedBy(...ids: Array<string | undefined>) {
  const describedBy = ids.filter(Boolean).join(" ");
  return describedBy.length > 0 ? describedBy : undefined;
}
