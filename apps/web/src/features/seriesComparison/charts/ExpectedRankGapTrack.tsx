import {
  formatAxisTick,
  gapAxisPosition,
} from "@/features/seriesComparison/model/expectedRankGapPresentation";
import type { GapAxis } from "@/features/seriesComparison/model/expectedRankGapPresentation";
import { cn } from "@/shared/ui/cn";

/** A data mark, not a surface: the neutral range that a gap reaches by chance. */
const bandClass = "bg-[color-mix(in_oklab,var(--color-analysis-neutral)_22%,transparent)]";
const markerClass = "bg-[var(--color-text-primary)]";

/**
 * One row of the diverging gap chart. The exact values live in the neighbouring cells, so the
 * mark is decorative for assistive technology; its axis is shared by every row of the section.
 */
export function ExpectedRankGapTrack({
  axis,
  band,
  marker,
  value,
}: {
  axis: GapAxis;
  band: number | null;
  marker?: number | null | undefined;
  value: number | null;
}) {
  const width = value === null ? 0 : (Math.min(Math.abs(value), axis.scale) / axis.scale) * 50;
  const bandHalf = band === null ? 0 : (Math.min(band, axis.scale) / axis.scale) * 50;
  return (
    <div aria-hidden="true" className="relative h-5 min-w-24">
      {bandHalf > 0 ? (
        <span
          className={cn("absolute inset-y-0.5", bandClass)}
          style={{ left: `${50 - bandHalf}%`, width: `${bandHalf * 2}%` }}
        />
      ) : null}
      {axis.ticks.map((tick) => (
        <span
          className={cn(
            "absolute w-px",
            Math.abs(tick) < 1e-9
              ? "inset-y-0 bg-[var(--color-border-strong)]"
              : "inset-y-1 bg-[var(--color-border)]",
          )}
          key={tick}
          style={{ left: `${gapAxisPosition(tick, axis.scale)}%` }}
        />
      ))}
      {value !== null && width > 0 ? (
        <span
          className={cn(
            "absolute inset-y-1",
            value > 0
              ? "rounded-r-xs bg-[var(--color-analysis-positive)]"
              : "rounded-l-xs bg-[var(--color-analysis-negative)]",
          )}
          style={
            value > 0
              ? { left: "50%", width: `${width}%` }
              : { left: `${50 - width}%`, width: `${width}%` }
          }
        />
      ) : null}
      {marker === null || marker === undefined ? null : (
        <span
          className={cn("absolute inset-y-0 -ml-px w-0.5", markerClass)}
          style={{ left: `${gapAxisPosition(marker, axis.scale)}%` }}
        />
      )}
    </div>
  );
}

/**
 * The shared axis heading: which side is above or below expectation, then the ticks. The sides
 * carry the direction once, so rows read their direction from position and sign alone.
 */
export function ExpectedRankGapAxis({ axis, className }: { axis: GapAxis; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("grid min-w-24 gap-0.5", className)}>
      <div className="font-plain flex justify-between gap-2 text-xs/4 text-[var(--color-text-secondary)]">
        <span>← 見込みより下位</span>
        <span>見込みより上位 →</span>
      </div>
      <AxisTicks axis={axis} />
    </div>
  );
}

function AxisTicks({ axis }: { axis: GapAxis }) {
  return (
    <div className="relative h-4">
      {axis.ticks.map((tick, index) => {
        const first = index === 0;
        const last = index === axis.ticks.length - 1;
        return (
          <span
            className={cn(
              "absolute top-0 text-xs/4 font-plain whitespace-nowrap text-[var(--color-text-muted)] tabular-nums",
              first ? "" : last ? "-translate-x-full" : "-translate-x-1/2",
            )}
            key={tick}
            style={{ left: `${gapAxisPosition(tick, axis.scale)}%` }}
          >
            {formatAxisTick(tick)}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Legend keys, each shown once in the section: the band under the first chart, and the
 * whole-table marker only while a player is selected.
 */
export function ExpectedRankGapLegend({ band, marker }: { band: boolean; marker: boolean }) {
  if (!band && !marker) return null;
  return (
    <p className="font-plain flex flex-wrap items-center gap-x-4 gap-y-1 text-xs/4 text-[var(--color-text-muted)]">
      {band ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className={cn("h-3 w-6", bandClass)} />
          差がなくても偶然で動く範囲
        </span>
      ) : null}
      {marker ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className={cn("h-3 w-0.5", markerClass)} />
          場全体の値
        </span>
      ) : null}
    </p>
  );
}
