import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { currentInternalLocation, withReturnTo } from "@/shared/navigation/returnTo";
import { cn } from "@/shared/ui/cn";

export function SeriesAnalysisMatchLink({
  ariaLabel,
  children,
  className,
  matchId,
  title,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string | undefined;
  matchId: string;
  title?: string | undefined;
}) {
  const returnTo = currentInternalLocation(useLocation());
  return (
    <Link
      aria-label={ariaLabel}
      className={cn(
        "inline-flex min-h-11 items-center font-semibold text-[var(--color-action)] underline-offset-4 hover:underline",
        className,
      )}
      title={title}
      to={withReturnTo(`/matches/${encodeURIComponent(matchId)}`, returnTo)}
    >
      {children}
    </Link>
  );
}
