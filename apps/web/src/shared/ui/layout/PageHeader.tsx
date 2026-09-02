import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

type PageHeaderProps = {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
};

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
          <p className="momo-copy mt-2 max-w-3xl text-sm text-[var(--color-text-secondary)]">
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
