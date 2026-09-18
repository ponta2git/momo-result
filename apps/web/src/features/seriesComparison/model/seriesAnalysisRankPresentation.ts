const numberFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const importanceFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 6,
  minimumFractionDigits: 3,
  signDisplay: "exceptZero",
});

const rankSignalLabels = new Map([
  ["revenue", "物件収益"],
  ["destination", "目的地"],
  ["plus_station", "プラス駅"],
  ["minus_station", "マイナス駅"],
  ["card_station", "カード駅"],
  ["card_shop", "カード売り場"],
  ["ginji", "スリの銀次"],
]);

export function rankSignalLabel(signal: string): string {
  return rankSignalLabels.get(signal) ?? "その他の要因";
}

export function rankSignalCandidateShareLabel(
  candidateSharePercent: number | null,
  candidateCount: number,
): string {
  if (candidateCount === 1) return "候補はこの1件";
  if (candidateSharePercent === null) return "—";
  return `${numberFormatter.format(candidateSharePercent)}%`;
}

export function rankSignalFoldLabel(fold: number): string {
  return fold >= 0 && fold < 26 ? String.fromCodePoint(65 + fold) : String(fold + 1);
}

export function formatRankSignalImportance(value: number): string {
  return Number.isFinite(value) ? importanceFormatter.format(value) : "—";
}
