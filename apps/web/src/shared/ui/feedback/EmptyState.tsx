import type { ReactNode } from "react";

export type EmptyStateProps = {
  action?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  placement?: "embedded" | "standalone";
  title: ReactNode;
};

export function EmptyState({
  action,
  description,
  icon,
  placement = "standalone",
  title,
}: EmptyStateProps) {
  return (
    <section
      className={
        placement === "standalone"
          ? "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          : "bg-transparent py-4"
      }
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <div
            aria-hidden="true"
            className="shrink-0 pt-0.5 text-[var(--color-text-secondary)] [&_svg]:size-5"
          >
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <h3 className="momo-heading text-base font-semibold text-[var(--color-text-primary)]">
            {title}
          </h3>
          {description ? (
            <div className="momo-copy mt-1 text-sm text-[var(--color-text-secondary)]">
              {description}
            </div>
          ) : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </section>
  );
}
