import type { PlayerRadarAxisId } from "@/shared/seriesAnalysis/playerRadarPresentation";

/** Walk the raw-value axis left to right; equality always earns the higher score. */
export function radarScoringSteps(axisId: PlayerRadarAxisId, thresholds: readonly number[]) {
  const steps = thresholds.map((rawValue, index) => ({
    rawValue,
    from: axisId === "averageRank" ? index + 2 : index + 1,
    to: axisId === "averageRank" ? index + 1 : index + 2,
    inclusiveScore: index + 2,
  }));
  return axisId === "averageRank" ? steps.toReversed() : steps;
}

/** Normalize before subtracting so finite signed monetary values cannot overflow the SVG. */
export function radarCurveScale(values: readonly number[]) {
  const finite = values.filter(Number.isFinite);
  const divisor = Math.max(1, ...finite.map(Math.abs));
  const minimum = finite.length > 0 ? Math.min(...finite) : 0;
  const maximum = finite.length > 0 ? Math.max(...finite) : 1;
  const low = minimum / divisor;
  const high = maximum / divisor;
  const span = high - low;
  const position = (value: number) =>
    span === 0 ? 0.5 : 0.04 + (0.92 * (value / divisor - low)) / span;
  return {
    position,
    ticks: [minimum, ((low + high) / 2) * divisor, maximum].filter(
      (value, index, all) => index === 0 || value !== all[index - 1],
    ),
  };
}
