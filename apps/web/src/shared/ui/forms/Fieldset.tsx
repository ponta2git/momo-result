import { useId } from "react";
import type { FieldsetHTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { controlBorderClass } from "@/shared/ui/forms/controlPresentation";
import { buildFieldDescribedBy } from "@/shared/ui/forms/Field";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { fieldText } from "@/shared/ui/typography";

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
      aria-invalid={error ? true : props["aria-invalid"]}
      className="min-w-0"
    >
      <legend className={fieldText.label}>{legend}</legend>
      <div
        className={cn(
          "mt-2 flex min-h-11 min-w-0 flex-wrap items-center gap-1 rounded-sm border bg-[var(--color-surface)] px-1 py-1",
          error ? controlBorderClass.invalid : controlBorderClass.default,
        )}
      >
        {children}
      </div>
      <div className="mt-1 flex min-w-0 flex-col gap-1 empty:hidden">
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
    </fieldset>
  );
}
