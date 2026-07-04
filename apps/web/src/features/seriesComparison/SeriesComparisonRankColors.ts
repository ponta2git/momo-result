import { isFiniteNumber } from "@/features/seriesComparison/SeriesComparisonChartTypes";

export function rankColor(rank: number): string {
  if (rank === 1) return "var(--color-rank-1)";
  if (rank === 2) return "var(--color-rank-2)";
  if (rank === 3) return "var(--color-rank-3)";
  return "var(--color-rank-4)";
}

export function rankForegroundColor(rank: number): string {
  return rank === 1 ? "var(--color-text-primary)" : "white";
}

export function colorMix(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

export function rankBackgroundColor(rank: number, rate: number): string {
  const alpha = Math.min(0.4, Math.max(0.08, rate * 0.42));
  return colorMix(rankColor(rank), alpha);
}

export function rankBorderColor(rank: number): string {
  return colorMix(rankColor(rank), 0.45);
}

export function rankAverageTone(
  value: number,
  minValue: number | undefined,
  maxValue: number | undefined,
): string {
  if (!isFiniteNumber(minValue) || !isFiniteNumber(maxValue) || maxValue === minValue) {
    return colorMix("var(--color-tray-incident)", 0.1);
  }
  const ratio = (value - minValue) / (maxValue - minValue);
  if (ratio <= 0.5) {
    const alpha = 0.08 + (0.5 - ratio) * 0.54;
    return colorMix("var(--color-action)", alpha);
  }
  const alpha = 0.08 + (ratio - 0.5) * 0.54;
  return colorMix("var(--color-danger)", alpha);
}
