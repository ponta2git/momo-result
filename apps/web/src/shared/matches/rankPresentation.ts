export function rankColor(rank: number): string {
  if (rank === 1) return "var(--color-rank-1)";
  if (rank === 2) return "var(--color-rank-2)";
  if (rank === 3) return "var(--color-rank-3)";
  if (rank === 4) return "var(--color-rank-4)";
  return "var(--color-text-muted)";
}

export function rankForegroundColor(rank: number): string {
  if (rank === 1) return "var(--color-rank-1-foreground)";
  if (rank === 2) return "var(--color-rank-2-foreground)";
  if (rank === 3) return "var(--color-rank-3-foreground)";
  if (rank === 4) return "var(--color-rank-4-foreground)";
  return "var(--color-text-primary)";
}

export function colorMix(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

function colorMixOnSurface(color: string, rate: number): string {
  return `color-mix(in oklab, ${color} ${Math.round(rate * 100)}%, var(--color-surface))`;
}

export function rankBackgroundColor(rank: number, rate: number): string {
  const alpha = Math.min(0.4, Math.max(0.08, rate * 0.42));
  return colorMixOnSurface(rankColor(rank), alpha);
}

export function rankBorderColor(rank: number): string {
  return colorMixOnSurface(rankColor(rank), 0.45);
}

export function rankBadgeBackgroundColor(rank: number): string {
  return colorMixOnSurface(rankColor(rank), 0.14);
}

export function rankBadgeBorderColor(rank: number): string {
  return colorMixOnSurface(rankColor(rank), 0.55);
}
