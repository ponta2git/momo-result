import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";

type PageHeaderProps = {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
};

/** Keeps multi-action headers two-column and predictable until inline labels have enough room. */
export const responsivePageHeaderActionGroupClass =
  "grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center";

export function PageHeader({ actions, description, eyebrow, meta, title }: PageHeaderProps) {
  return (
    <header className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="momo-label text-[var(--color-text-secondary)]">{eyebrow}</p>
        ) : null}
        <h1
          className={cn(
            "momo-heading text-2xl font-semibold text-balance text-[var(--color-text-primary)] md:text-3xl",
            eyebrow ? "mt-1" : "",
          )}
        >
          {title}
        </h1>
        {description ? (
          <p
            className={cn(
              "momo-copy mt-2 text-sm text-[var(--color-text-secondary)]",
              readableTextWidthClass,
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {meta || actions ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
          {meta ? <div className="shrink-0">{meta}</div> : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}
