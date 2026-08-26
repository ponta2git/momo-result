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
  ariaLabel: string;
  busy?: boolean | undefined;
  className?: string | undefined;
  details?: FilterBarDetails | undefined;
  meta?: ReactNode | undefined;
  primary: ReactNode;
  resetAction?: ReactNode | undefined;
};

/**
 * Owns the cross-feature filter operation group: labeled scope, primary controls, one detail
 * disclosure whose summary owns active hidden conditions, and stable reset/action placement.
 * Query and cache behavior deliberately remain with the feature composition.
 */
export function FilterBar({
  action,
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
      className={cn("min-w-0", className)}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
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
            className="group"
            keepMounted
            open={details.open}
            panelClassName={cn("grid gap-4 p-3", details.panelClassName)}
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

        {meta ? (
          <div className="min-w-0 pt-1 text-xs text-[var(--color-text-secondary)] tabular-nums sm:text-right">
            {meta}
          </div>
        ) : null}
      </div>
    </section>
  );
}
