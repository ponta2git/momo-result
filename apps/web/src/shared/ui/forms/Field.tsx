import { useId } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { fieldText } from "@/shared/ui/typography";

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
        "min-w-0",
        layout === "subgrid"
          ? "flex flex-col md:grid md:grid-rows-subgrid md:gap-y-0"
          : "flex flex-col",
      )}
      {...props}
      data-field-root=""
    >
      <label className={cn(fieldText.label, "mb-2")} htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-1 text-[var(--color-danger)]">*</span> : null}
      </label>
      <div className="min-w-0">{children}</div>
      <div className="mt-1 flex min-w-0 flex-col gap-1 empty:hidden">
        {description ? (
          <p
            id={resolvedDescriptionId}
            className={cn(fieldText.description, "min-w-0 text-pretty", readableTextWidthClass)}
          >
            {description}
          </p>
        ) : null}
        {error ? (
          <p
            id={resolvedErrorId}
            className={cn(fieldText.error, "min-w-0 text-pretty", readableTextWidthClass)}
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function buildFieldDescribedBy(...ids: Array<string | undefined>) {
  const describedBy = ids.filter(Boolean).join(" ");
  return describedBy.length > 0 ? describedBy : undefined;
}
