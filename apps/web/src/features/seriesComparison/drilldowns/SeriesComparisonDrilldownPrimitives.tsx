import type { ReactNode } from "react";

import { playerColor } from "@/features/seriesComparison/charts/SeriesComparisonPlayerVisuals";
import type { Player } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import { isNumber } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

type DeltaValueKind = "decimal" | "rank";
type LowerIsBetterDeltaLabels = {
  negative: string;
  positive: string;
  zero: string;
};

export function DrilldownContentSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="grid min-h-48 gap-3" role="status">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {["summary-1", "summary-2", "summary-3", "summary-4"].map((id) => (
          <Skeleton key={id} className="h-20 rounded-[var(--radius-sm)]" />
        ))}
      </div>
      <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    </div>
  );
}

export function DrilldownLoadNotice({
  description,
  onRetry,
  pending = false,
  title,
  tone = "danger",
}: {
  description: string;
  onRetry: () => void;
  pending?: boolean;
  title: string;
  tone?: "danger" | "warning";
}) {
  return (
    <Notice title={title} tone={tone}>
      <p>{description}</p>
      <div className="mt-3">
        <Button
          pending={pending}
          pendingLabel="再読み込み中"
          size="sm"
          variant="secondary"
          onClick={onRetry}
        >
          履歴を再読み込み
        </Button>
      </div>
    </Notice>
  );
}

export function DrilldownPlayerSelector({
  players,
  selectedMemberId,
  onMemberChange,
}: {
  players: Player[];
  selectedMemberId: string | undefined;
  onMemberChange: (memberId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {players.map((player, index) => {
        const selected = player.memberId === selectedMemberId;
        return (
          <Button
            key={player.memberId}
            className={cn(
              "justify-start border-l-4",
              selected ? "bg-[var(--color-action)]/10" : "",
            )}
            size="sm"
            style={{ borderLeftColor: playerColor(index) }}
            variant={selected ? "secondary" : "quiet"}
            onClick={() => onMemberChange(player.memberId)}
          >
            {player.displayName}
          </Button>
        );
      })}
    </div>
  );
}

export function DrilldownTableScroll({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="h-full min-h-0 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      {children}
    </div>
  );
}

export function DrilldownTableHeader({
  align = "left",
  children,
  className,
}: {
  align?: "left" | "right";
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "sticky top-0 z-[var(--z-sticky)] border-b border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      scope="col"
    >
      {children}
    </th>
  );
}

export function DrilldownTableCell({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <td
      className={cn(
        "border-b border-[var(--color-border)] px-3 py-3 align-top text-[var(--color-text-primary)] tabular-nums group-last:border-b-0",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

export function DrilldownStickyCell({ children }: { children: ReactNode }) {
  return (
    <td className="sticky left-0 z-[var(--z-base)] border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 align-top text-[var(--color-text-primary)] tabular-nums group-last:border-b-0 group-hover:bg-[var(--color-surface-subtle)]">
      {children}
    </td>
  );
}

export function LowerIsBetterDeltaBadge({
  labels,
  nullLabel,
  value,
  valueKind,
}: {
  labels: LowerIsBetterDeltaLabels;
  nullLabel: string;
  value: number | null | undefined;
  valueKind: DeltaValueKind;
}) {
  if (!isNumber(value)) {
    return <span className="text-[var(--color-text-muted)]">{nullLabel}</span>;
  }
  const tone = lowerIsBetterTone(value);
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-[var(--radius-xs)] border px-2 py-0.5 text-xs font-semibold tabular-nums",
        tone === "negative" &&
          "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-text-primary)]",
        tone === "positive" &&
          "border-[var(--color-review)]/45 bg-[var(--color-review)]/10 text-[var(--color-text-primary)]",
        tone === "zero" &&
          "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
      )}
    >
      {formatDeltaMagnitude(value, valueKind)} {labels[tone]}
    </span>
  );
}

export function formatLowerIsBetterDelta(
  value: number | null | undefined,
  valueKind: DeltaValueKind,
  labels: LowerIsBetterDeltaLabels,
  nullLabel: string,
): string {
  if (!isNumber(value)) {
    return nullLabel;
  }
  const tone = lowerIsBetterTone(value);
  return `${formatDeltaMagnitude(value, valueKind)} ${labels[tone]}`;
}

function lowerIsBetterTone(value: number): keyof LowerIsBetterDeltaLabels {
  if (value < 0) {
    return "negative";
  }
  if (value > 0) {
    return "positive";
  }
  return "zero";
}

function formatDeltaMagnitude(value: number, valueKind: DeltaValueKind): string {
  const absolute = Math.abs(value);
  return valueKind === "rank" ? `${Math.trunc(absolute)}位` : absolute.toFixed(2);
}
