import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

export type FactListItem = {
  id: string;
  label: ReactNode;
  value: ReactNode;
};

export type FactListProps = {
  ariaLabel: string;
  columns?: 1 | 2 | 3 | 4 | undefined;
  items: readonly FactListItem[];
  layout?: "plain" | "grid" | "inline" | "segmented" | undefined;
};

const columnsClass = {
  1: "grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const;

/**
 * Owns term/value semantics, label proximity, and numeric alignment.
 * Plain facts share the surrounding surface; choose them for reading-oriented
 * content and metadata that do not represent a separate state or control.
 */
export function FactList({ ariaLabel, columns = 1, items, layout = "grid" }: FactListProps) {
  return (
    <dl
      aria-label={ariaLabel}
      className={cn(
        "grid min-w-0",
        columnsClass[columns],
        layout === "segmented"
          ? "gap-px overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-border)]"
          : layout === "grid" || layout === "plain"
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
              ? "rounded-sm border border-[var(--color-border)] px-3 py-2"
              : layout === "inline"
                ? "flex items-baseline justify-between gap-4 py-1"
                : "",
          )}
          key={item.id}
        >
          <dt
            className={
              layout === "plain"
                ? contentText.supporting
                : "font-plain text-xs text-[var(--color-text-secondary)]"
            }
          >
            {item.label}
          </dt>
          <dd
            className={cn(
              "min-w-0 break-words tabular-nums",
              layout === "plain" ? contentText.body : "text-sm font-plain",
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
