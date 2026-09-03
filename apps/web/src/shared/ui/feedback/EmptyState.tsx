import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";

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
          ? "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
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
          <h3
            className={cn(
              "momo-heading text-base font-semibold text-[var(--color-text-primary)]",
              readableTextWidthClass,
            )}
          >
            {title}
          </h3>
          {description ? (
            <div
              className={cn(
                "momo-copy mt-1 text-sm text-[var(--color-text-secondary)] text-pretty",
                readableTextWidthClass,
              )}
            >
              {description}
            </div>
          ) : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </section>
  );
}
