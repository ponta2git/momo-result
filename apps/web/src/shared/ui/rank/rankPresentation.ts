export function rankColor(rank: number): string {
  if (rank === 1) return "var(--color-rank-1)";
  if (rank === 2) return "var(--color-rank-2)";
  if (rank === 3) return "var(--color-rank-3)";
  if (rank === 4) return "var(--color-rank-4)";
  return "var(--color-text-muted)";
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
  minimum: number | undefined,
  maximum: number | undefined,
): string {
  if (
    minimum === undefined ||
    maximum === undefined ||
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    maximum === minimum
  ) {
    return colorMix("var(--color-tray-incident)", 0.1);
  }
  const ratio = (value - minimum) / (maximum - minimum);
  const distance = Math.abs(ratio - 0.5);
  const alpha = 0.08 + distance * 0.54;
  return colorMix(
    ratio <= 0.5 ? "var(--color-analysis-positive)" : "var(--color-analysis-negative)",
    alpha,
  );
}
