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
  layout?: "plain" | "inline" | undefined;
};

const columnsClass = {
  1: "grid-cols-1",
  2: "@sm/facts:grid-cols-2",
  3: "@sm/facts:grid-cols-2 @2xl/facts:grid-cols-3",
  4: "@sm/facts:grid-cols-2 @3xl/facts:grid-cols-4",
} as const;

/**
 * Owns term/value semantics, label proximity, and numeric alignment.
 * Plain facts share the surrounding surface; choose them for reading-oriented
 * content and metadata that do not represent a separate state or control.
 */
export function FactList({ ariaLabel, columns = 1, items, layout = "plain" }: FactListProps) {
  return (
    <div className={cn("min-w-0", columns > 1 && "@container/facts")}>
      <dl
        aria-label={ariaLabel}
        className={cn(
          "grid min-w-0 grid-cols-1",
          columnsClass[columns],
          layout === "inline" ? "gap-1" : "gap-2",
        )}
      >
        {items.map((item) => (
          <div
            className={cn(
              "min-w-0",
              layout === "inline" && "flex items-baseline justify-between gap-4 py-1",
            )}
            key={item.id}
          >
            <dt
              className={cn(
                "min-w-0",
                layout === "plain"
                  ? contentText.supporting
                  : "font-plain text-xs text-[var(--color-text-secondary)]",
              )}
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
    </div>
  );
}
