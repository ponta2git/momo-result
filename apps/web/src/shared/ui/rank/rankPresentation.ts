export function rankColor(rank: number): string {
  if (rank === 1) return "var(--color-rank-1)";
  if (rank === 2) return "var(--color-rank-2)";
  if (rank === 3) return "var(--color-rank-3)";
  if (rank === 4) return "var(--color-rank-4)";
  return "var(--color-text-muted)";
}

export function colorMix(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
