import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

type PageHeaderProps = {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
};

export function PageHeader({
  actions,
  className,
  description,
  eyebrow,
  meta,
  title,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex min-w-0 flex-col gap-3 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 text-xl font-semibold text-balance text-[var(--color-text-primary)] md:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
            {description}
          </p>
        ) : null}
      </div>
      {meta ? <div className="shrink-0">{meta}</div> : null}
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
