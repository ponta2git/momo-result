import { useId } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

export type FieldLayout = "stack" | "subgrid";

export type FieldProps = {
  children: ReactNode;
  description?: ReactNode | undefined;
  descriptionId?: string | undefined;
  error?: ReactNode | undefined;
  errorId?: string | undefined;
  htmlFor: string;
  label: ReactNode;
  layout?: FieldLayout | undefined;
  required?: boolean | undefined;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "style">;

export function Field({
  children,
  description,
  descriptionId,
  error,
  errorId,
  htmlFor,
  label,
  layout = "stack",
  required,
  ...props
}: FieldProps) {
  const fallbackId = useId();
  const resolvedDescriptionId = description
    ? (descriptionId ?? `${fallbackId}-description`)
    : undefined;
  const resolvedErrorId = error ? (errorId ?? `${fallbackId}-error`) : undefined;

  return (
    <div
      className={cn(
        "min-w-0 gap-2",
        layout === "subgrid" ? "flex flex-col md:grid md:grid-rows-subgrid" : "flex flex-col",
      )}
      {...props}
      data-field-root=""
    >
      <label
        className="text-sm leading-5 font-semibold text-[var(--color-text-primary)]"
        htmlFor={htmlFor}
      >
        {label}
        {required ? <span className="ml-1 text-[var(--color-danger)]">*</span> : null}
      </label>
      {children}
      {description ? (
        <p
          id={resolvedDescriptionId}
          className="momo-copy min-w-0 text-xs text-[var(--color-text-secondary)]"
        >
          {description}
        </p>
      ) : null}
      {error ? (
        <p
          id={resolvedErrorId}
          className="momo-copy min-w-0 text-xs text-[var(--color-danger)]"
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
