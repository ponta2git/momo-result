const numberFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });

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
