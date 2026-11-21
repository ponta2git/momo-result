import { numberTicks } from "@/features/seriesComparison/charts/dataViz/scales";
import type { CumulativePair } from "@/features/seriesComparison/outlook/calculation";

/**
 * The need line is the existing reverse calculation drawn for every game count:
 * after `h` more games the focus member is ahead exactly when their future mean is below
 * `rivalMean - (focusRankSum - rivalRankSum) / h`. Drawing uses floats; every stated result
 * (crossing game, required mean) still comes from the exact rational calculation.
 */
export function needLineThreshold(cumulative: CumulativePair, rivalMean: number, h: number) {
  return rivalMean - (cumulative.focusRankSum - cumulative.rivalRankSum) / h;
}

export type NeedLineScale = { min: number; max: number; ticks: number[] };

/**
 * Fit the vertical axis to the lines the reader compares (both future means, any kept or
 * previewed mean, and the need line at the right edge and the goal), with room around them.
 * The steep start of the curve is allowed to leave the plot instead of flattening the rest.
 */
export function needLineScale(values: readonly number[]): NeedLineScale {
  const finite = values.filter((value) => Number.isFinite(value));
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const padding = Math.max(0.12, (high - low) * 0.25);
  const ticks = numberTicks(
    Math.max(1, low - padding),
    Math.min(4, high + padding),
    5,
    0.05,
  ).filter((tick) => tick >= 1 && tick <= 4);
  return { min: ticks[0] ?? 1, max: ticks.at(-1) ?? 4, ticks };
}

/** Sample the need line densely near the start, where it bends, and sparsely afterwards. */
export function needLinePoints(
  cumulative: CumulativePair,
  rivalMean: number,
  range: number,
): Array<readonly [number, number]> {
  const bend = Math.min(range, 10);
  const points: Array<readonly [number, number]> = [];
  for (let step = 1; step * 0.25 < bend; step++) {
    points.push([step * 0.25, needLineThreshold(cumulative, rivalMean, step * 0.25)]);
  }
  for (let step = 0; step <= 100; step++) {
    const h = bend + ((range - bend) * step) / 100;
    points.push([h, needLineThreshold(cumulative, rivalMean, h)]);
  }
  return points;
}
