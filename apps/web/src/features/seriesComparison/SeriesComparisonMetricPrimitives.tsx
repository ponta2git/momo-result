import { HelpCircle } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import {
  playerColor,
  playerGridStyle,
} from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import type {
  MetricEmphasis,
  Player,
  PlayerMetrics,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import { statusLabel } from "@/features/seriesComparison/seriesComparisonViewModel";
import { cn } from "@/shared/ui/cn";
import { Tooltip } from "@/shared/ui/feedback/Tooltip";

export function PlayerMetricGrid({
  cardClassName,
  children,
  contentClassName,
  minColumnWidthRem = 11,
  metricsByMember,
  players,
}: {
  cardClassName?: string;
  children: (player: Player, metrics: PlayerMetrics | undefined, index: number) => ReactNode;
  contentClassName?: string;
  minColumnWidthRem?: number;
  metricsByMember: Map<string, PlayerMetrics>;
  players: Player[];
}) {
  const gridStyle = {
    ...playerGridStyle(players.length),
    "--player-column-min": `${minColumnWidthRem}rem`,
  } as CSSProperties;
  return (
    <div className="max-w-full min-w-0 pb-1">
      <div
        className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(var(--player-count),minmax(var(--player-column-min),1fr))]"
        style={gridStyle}
      >
        {players.map((player, index) => (
          <div
            key={player.memberId}
            className={cn(
              "min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3",
              cardClassName,
            )}
            style={{ borderTopColor: playerColor(index), borderTopWidth: 3 }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: playerColor(index) }}
              />
              <p className="min-w-0 text-sm font-semibold break-words text-[var(--color-text-primary)]">
                {player.displayName}
              </p>
            </div>
            <div className={cn("mt-3 grid gap-2", contentClassName)}>
              {children(player, metricsByMember.get(player.memberId), index)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MetricRow({
  emphasis,
  help,
  label,
  status,
  value,
}: {
  emphasis?: MetricEmphasis | undefined;
  help?: ReactNode;
  label: string;
  status?: string | null | undefined;
  value: ReactNode;
}) {
  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-[var(--color-border)] pb-2 last:border-b-0 last:pb-0">
      <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-4 text-[var(--color-text-secondary)]">
        <span className="min-w-0 break-words">{label}</span>
        <StatusBadge status={status} />
        {emphasis ? <EmphasisBadge emphasis={emphasis} /> : null}
        {help ? <FormulaHelp content={help} label={label} /> : null}
      </span>
      <span
        className={cn(
          "min-w-0 text-right text-sm font-semibold break-words tabular-nums",
          emphasisTextClass(emphasis?.kind),
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function EmphasisBadge({ emphasis }: { emphasis: MetricEmphasis }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-[var(--radius-xs)] border px-1 py-px text-[10px] font-semibold leading-4",
        emphasisBadgeClass(emphasis.kind),
      )}
    >
      {emphasis.label}
    </span>
  );
}

function emphasisBadgeClass(kind: MetricEmphasis["kind"]): string {
  switch (kind) {
    case "strength":
      return "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-success)]";
    case "risk":
      return "border-[var(--color-review)]/55 bg-[var(--color-review)]/10 text-[var(--color-review)]";
    case "leader":
      return "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-success)]";
    default:
      return "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]";
  }
}

export function emphasisTextClass(kind: MetricEmphasis["kind"] | undefined): string {
  switch (kind) {
    case "strength":
    case "leader":
      return "text-[var(--color-success)]";
    case "risk":
      return "text-[var(--color-review)]";
    default:
      return "text-[var(--color-text-primary)]";
  }
}

function FormulaHelp({ content, label }: { content: ReactNode; label: string }) {
  return (
    <Tooltip content={content}>
      <button
        aria-label={`「${label}」の計算式を表示`}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
        type="button"
      >
        <HelpCircle aria-hidden="true" className="size-3.5" />
      </button>
    </Tooltip>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const label = statusLabel(status);
  if (!label) {
    return null;
  }
  return (
    <span className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
      {label}
    </span>
  );
}
