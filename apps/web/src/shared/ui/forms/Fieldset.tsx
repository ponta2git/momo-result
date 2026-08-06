import { useId } from "react";
import type { FieldsetHTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { buildFieldDescribedBy } from "@/shared/ui/forms/Field";

type FieldsetProps = {
  children: ReactNode;
  contentClassName?: string | undefined;
  description?: ReactNode | undefined;
  error?: ReactNode | undefined;
  legend: ReactNode;
} & FieldsetHTMLAttributes<HTMLFieldSetElement>;

export function Fieldset({
  children,
  className,
  contentClassName,
  description,
  error,
  legend,
  ...props
}: FieldsetProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <fieldset
      {...props}
      aria-describedby={buildFieldDescribedBy(descriptionId, errorId, props["aria-describedby"])}
      className={cn("min-w-0", className)}
    >
      <legend className="text-sm leading-5 font-semibold text-[var(--color-text-primary)]">
        {legend}
      </legend>
      <div
        className={cn(
          "mt-1 flex min-h-11 min-w-0 flex-wrap items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1",
          contentClassName,
        )}
      >
        {children}
      </div>
      {description ? (
        <p className="momo-copy mt-1 text-xs text-[var(--color-text-secondary)]" id={descriptionId}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p className="momo-copy mt-1 text-xs text-[var(--color-danger)]" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
