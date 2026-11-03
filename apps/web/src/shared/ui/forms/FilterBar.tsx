import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { contentText } from "@/shared/ui/typography";

export type FilterBarDetails = {
  align?: "end" | "start" | undefined;
  columns?: 1 | 2 | 3 | undefined;
  controls: ReactNode;
  label: ReactNode;
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
  summary?: ReactNode | undefined;
};

export type FilterBarProps = {
  action?: ReactNode | undefined;
  ariaLabel: string;
  busy?: boolean | undefined;
  details?: FilterBarDetails | undefined;
  meta?: ReactNode | undefined;
  primary: ReactNode;
  resetAction?: ReactNode | undefined;
};

/**
 * Owns the cross-feature filter operation group: labeled scope, primary controls, one detail
 * disclosure whose summary owns active hidden conditions, and stable reset/action placement.
 * Query and cache behavior deliberately remain with the feature composition.
 * Keep it beside the data surface it scopes. Summaries name only non-default hidden values,
 * never visible primary controls or sort, and an unknown `meta` count reads as unknown, not 0.
 */
export function FilterBar({
  action,
  ariaLabel,
  busy = false,
  details,
  meta,
  primary,
  resetAction,
}: FilterBarProps) {
  return (
    <section aria-busy={busy || undefined} aria-label={ariaLabel} className="min-w-0">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <div
          className={cn(
            "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3",
            resetAction || action ? "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" : "",
          )}
        >
          <div className="min-w-0">{primary}</div>
          {resetAction || action ? (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {resetAction}
              {action}
            </div>
          ) : null}
        </div>

        {details ? (
          <Disclosure
            keepMounted
            open={details.open}
            panelPadding="sm"
            summary={
              <span className="min-w-0">
                <span className={cn(contentText.body, "block text-[var(--color-text-primary)]")}>
                  {details.label}
                </span>
                {details.summary ? (
                  <span className={cn(contentText.supporting, "mt-1 block text-pretty")}>
                    {details.summary}
                  </span>
                ) : null}
              </span>
            }
            triggerVariant="supporting"
            onOpenChange={details.onOpenChange}
          >
            <div
              className={cn(
                "grid gap-4",
                details.columns === 2
                  ? "md:grid-cols-2"
                  : details.columns === 3
                    ? "md:grid-cols-3"
                    : "",
                details.align === "end" ? "md:items-end" : "",
              )}
            >
              {details.controls}
            </div>
          </Disclosure>
        ) : null}

        {meta ? (
          <div className={cn(contentText.supporting, "min-w-0 tabular-nums sm:text-right")}>
            {meta}
          </div>
        ) : null}
      </div>
    </section>
  );
}
