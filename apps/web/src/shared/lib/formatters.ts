export function formatManYen(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const cho = Math.trunc(absolute / 100_000_000);
  const belowCho = absolute % 100_000_000;
  const oku = Math.trunc(belowCho / 10_000);
  const man = belowCho % 10_000;

  if (cho > 0) {
    const choPart = `${sign}${cho}兆`;
    const okuPart = oku > 0 ? `${oku}億` : "";
    const manPart = man > 0 ? `${oku > 0 ? String(man).padStart(4, "0") : man}万円` : "";
    return manPart ? `${choPart}${okuPart}${manPart}` : `${choPart}${okuPart}円`;
  }

  if (oku === 0) {
    return `${sign}${man}万円`;
  }

  if (man === 0) {
    return `${sign}${oku}億円`;
  }

  return `${sign}${oku}億${String(man).padStart(4, "0")}万円`;
}
