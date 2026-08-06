import type { ReactNode } from "react";

import {
  EmphasisBadge,
  emphasisTextClass,
} from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import type { MetricEmphasis } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";

export function IntegratedMetricPanel({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="grid w-full max-w-full min-w-0 gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        <p className="text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

export function FactGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="grid gap-2 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">{title}</p>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </div>
  );
}

export function FactChip({
  badge,
  label,
  subLabel,
  value,
}: {
  badge?: MetricEmphasis | undefined;
  label: string;
  subLabel?: string;
  value: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-2 py-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <p className="min-w-0 text-[10px] leading-4 font-medium break-words text-[var(--color-text-secondary)]">
          {label}
        </p>
        {badge ? <EmphasisBadge emphasis={badge} /> : null}
      </div>
      {subLabel ? (
        <p className="min-w-0 text-[10px] leading-4 break-words text-[var(--color-text-muted)]">
          {subLabel}
        </p>
      ) : null}
      <p
        className={cn(
          "mt-0.5 break-words text-xs font-semibold leading-4 tabular-nums",
          emphasisTextClass(badge?.kind),
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-xs)] bg-[var(--color-surface)] px-2 py-1">
      <p className="min-w-0 text-[10px] leading-4 break-words text-[var(--color-text-secondary)]">
        {label}
      </p>
      <p className="min-w-0 text-[11px] leading-4 font-semibold break-words text-[var(--color-text-primary)] tabular-nums">
        {value}
      </p>
    </div>
  );
}

export function OutcomeDetails({ children, title }: { children: ReactNode; title: string }) {
  return (
    <Disclosure
      className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)]"
      panelClassName="grid gap-2 border-t border-[var(--color-border)] px-2 py-2"
      summary={title}
      triggerClassName="text-xs text-[var(--color-text-secondary)]"
    >
      {children}
    </Disclosure>
  );
}
