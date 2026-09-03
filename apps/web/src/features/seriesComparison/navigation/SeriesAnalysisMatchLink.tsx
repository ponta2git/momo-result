import type { CSSProperties, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { currentInternalLocation, withReturnTo } from "@/shared/navigation/returnTo";
import { cn } from "@/shared/ui/cn";

export function SeriesAnalysisMatchLink({
  ariaLabel,
  children,
  colors,
  focused = false,
  matchId,
  presentation,
  title,
}: {
  ariaLabel: string;
  children: ReactNode;
  colors?: { background: string; border: string; foreground: string } | undefined;
  focused?: boolean | undefined;
  matchId: string;
  presentation: "axis" | "inline" | "rank-cell" | "text";
  title?: string | undefined;
}) {
  const returnTo = currentInternalLocation(useLocation());
  return (
    <Link
      aria-label={ariaLabel}
      className={cn(
        "inline-flex min-h-11 items-center font-semibold text-[var(--color-action)] underline-offset-4 hover:underline",
        presentation === "text"
          ? ""
          : presentation === "inline"
            ? "gap-1 text-xs"
            : presentation === "axis"
              ? cn(
                  "justify-center text-xs whitespace-nowrap",
                  focused ? "" : "text-[var(--color-text-muted)]",
                )
              : cn(
                  "size-11 justify-center overflow-hidden rounded-xs border p-0 text-xs tabular-nums no-underline hover:no-underline",
                  focused
                    ? "ring-2 ring-[var(--color-action)] ring-offset-2 ring-offset-[var(--color-surface)]"
                    : "",
                ),
      )}
      style={
        colors
          ? ({
              backgroundColor: colors.background,
              borderColor: colors.border,
              color: colors.foreground,
            } satisfies CSSProperties)
          : undefined
      }
      title={title}
      to={withReturnTo(`/matches/${encodeURIComponent(matchId)}`, returnTo)}
    >
      {children}
    </Link>
  );
}
