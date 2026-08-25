import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";

export type FilterBarDetails = {
  controls: ReactNode;
  label: ReactNode;
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
  panelClassName?: string | undefined;
  summary?: ReactNode | undefined;
};

export type FilterBarProps = {
  action?: ReactNode | undefined;
  activeSummary?: ReactNode | undefined;
  ariaLabel: string;
  busy?: boolean | undefined;
  className?: string | undefined;
  details?: FilterBarDetails | undefined;
  meta?: ReactNode | undefined;
  primary: ReactNode;
  resetAction?: ReactNode | undefined;
};

/**
 * Owns the cross-feature filter surface: labeled scope, primary controls, one detail
 * disclosure, complete active summary, and stable reset/action placement. Query and
 * cache behavior deliberately remain with the feature composition.
 */
export function FilterBar({
  action,
  activeSummary,
  ariaLabel,
  busy = false,
  className,
  details,
  meta,
  primary,
  resetAction,
}: FilterBarProps) {
  return (
    <section
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      className={cn(
        "min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4",
        className,
      )}
    >
      <div className="grid min-w-0 gap-4">
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">{primary}</div>
          {resetAction || action ? (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
              {resetAction}
              {action}
            </div>
          ) : null}
        </div>

        {details ? (
          <Disclosure
            className="group rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]"
            keepMounted
            open={details.open}
            panelClassName={cn(
              "grid gap-4 border-t border-[var(--color-border)] p-3",
              details.panelClassName,
            )}
            summary={
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
                  {details.label}
                </span>
                {details.summary ? (
                  <span className="mt-0.5 block text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
                    {details.summary}
                  </span>
                ) : null}
              </span>
            }
            triggerVariant="supporting"
            onOpenChange={details.onOpenChange}
          >
            {details.controls}
          </Disclosure>
        ) : null}

        {activeSummary || meta ? (
          <div className="grid min-w-0 gap-2 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-secondary)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0 text-pretty">{activeSummary}</div>
            {meta ? <div className="min-w-0 tabular-nums sm:text-right">{meta}</div> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
