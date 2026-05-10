export function formatManYen(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const oku = Math.trunc(absolute / 10_000);
  const man = absolute % 10_000;

  if (oku === 0) {
    return `${sign}${man}万円`;
  }

  if (man === 0) {
    return `${sign}${oku}億円`;
  }

  return `${sign}${oku}億${String(man).padStart(4, "0")}万円`;
}
