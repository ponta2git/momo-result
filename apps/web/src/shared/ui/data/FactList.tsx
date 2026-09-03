import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

export type FactListItem = {
  id: string;
  label: ReactNode;
  value: ReactNode;
};

export type FactListProps = {
  ariaLabel: string;
  columns?: 1 | 2 | 4 | undefined;
  items: readonly FactListItem[];
  layout?: "grid" | "inline" | "segmented" | undefined;
};

const columnsClass = {
  1: "grid-cols-1",
  2: "sm:grid-cols-2",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const;

/** Owns fact label/value semantics and consistent numeric alignment across finite layouts. */
export function FactList({ ariaLabel, columns = 1, items, layout = "grid" }: FactListProps) {
  return (
    <dl
      aria-label={ariaLabel}
      className={cn(
        "grid min-w-0",
        columnsClass[columns],
        layout === "segmented"
          ? "gap-px overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-border)]"
          : layout === "grid"
            ? "gap-2"
            : "gap-1",
      )}
    >
      {items.map((item) => (
        <div
          className={cn(
            "min-w-0",
            layout === "segmented" ? "bg-[var(--color-surface-subtle)] px-3 py-2" : "",
            layout === "grid"
              ? "rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2"
              : layout === "inline"
                ? "flex items-baseline justify-between gap-4 py-1"
                : "",
          )}
          key={item.id}
        >
          <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">{item.label}</dt>
          <dd
            className={cn(
              "min-w-0 text-sm font-semibold break-words tabular-nums",
              layout === "inline" ? "" : "mt-0.5",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
