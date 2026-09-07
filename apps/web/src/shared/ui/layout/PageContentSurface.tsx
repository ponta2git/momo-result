import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";

export type PageContentSurfacePadding = "compact" | "default" | "none";

type PageContentSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  padding?: PageContentSurfacePadding | undefined;
};

const paddingClass = {
  compact: "p-4",
  default: "p-4 sm:p-6",
  none: "",
} as const satisfies Record<PageContentSurfacePadding, string>;

/**
 * Owns the page-level white ledger plane for one continuous task or data scope.
 * Feature sections keep their own semantics and compose inside this surface.
 */
export function PageContentSurface({
  className,
  padding = "default",
  ...props
}: PageContentSurfaceProps) {
  return (
    <div
      className={cn(
        "w-full min-w-0 rounded-lg bg-[var(--color-surface)] text-[var(--color-text-primary)]",
        paddingClass[padding],
        className,
      )}
      data-page-content-surface=""
      {...props}
    />
  );
}
