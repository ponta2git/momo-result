import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

export type EmptyStateProps = {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
};

export function EmptyState({ action, className, description, icon, title }: EmptyStateProps) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <div aria-hidden="true" className="pt-0.5 text-[var(--color-text-secondary)]">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-balance text-[var(--color-text-primary)]">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
              {description}
            </p>
          ) : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </section>
  );
}
