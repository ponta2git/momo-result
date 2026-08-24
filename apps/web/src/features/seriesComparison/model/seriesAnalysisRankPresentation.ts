const numberFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const importanceFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 6,
  minimumFractionDigits: 3,
  signDisplay: "exceptZero",
});

export function rankSignalLabel(signal: string): string {
  switch (signal) {
    case "revenue":
      return "物件収益";
    case "destination":
      return "目的地";
    case "plus_station":
      return "プラス駅";
    case "minus_station":
      return "マイナス駅";
    case "card_station":
      return "カード駅";
    case "card_shop":
      return "カード売り場";
    case "ginji":
      return "スリの銀次";
    default:
      return "その他の要因";
  }
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
