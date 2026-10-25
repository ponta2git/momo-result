export function achievementDateTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const instant = Date.parse(value);
  return Number.isFinite(instant)
    ? new Date(instant + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)
    : "";
}

export function achievementDateTimeFromInput(value: string): string | null {
  if (!value) return null;
  const instant = Date.parse(`${value}+09:00`);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}
