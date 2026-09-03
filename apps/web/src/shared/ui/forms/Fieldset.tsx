import { useId } from "react";
import type { FieldsetHTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { buildFieldDescribedBy } from "@/shared/ui/forms/Field";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";

type FieldsetProps = {
  children: ReactNode;
  description?: ReactNode | undefined;
  error?: ReactNode | undefined;
  legend: ReactNode;
} & Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, "className" | "style">;

export function Fieldset({ children, description, error, legend, ...props }: FieldsetProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <fieldset
      {...props}
      aria-describedby={buildFieldDescribedBy(descriptionId, errorId, props["aria-describedby"])}
      className="min-w-0"
    >
      <legend className="text-sm leading-5 font-semibold text-[var(--color-text-primary)]">
        {legend}
      </legend>
      <div className="mt-1 flex min-h-11 min-w-0 flex-wrap items-center gap-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1">
        {children}
      </div>
      {description ? (
        <p
          className={cn(
            "momo-copy mt-1 text-xs text-[var(--color-text-secondary)]",
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
            "momo-copy mt-1 text-xs text-[var(--color-danger)]",
            readableTextWidthClass,
          )}
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
