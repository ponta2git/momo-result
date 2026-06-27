import type { ReactNode } from "react";

export function MetricSection({
  action,
  children,
  description,
  icon,
  id,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  icon: ReactNode;
  id?: string;
  title: string;
}) {
  return (
    <section
      className="grid w-full max-w-full min-w-0 gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
      id={id}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            aria-hidden="true"
            className="rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] p-2 text-[var(--color-action)]"
          >
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
