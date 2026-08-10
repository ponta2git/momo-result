export function assetStyleLabel(value: string | null): string {
  switch (value) {
    case "asset_explosion":
      return "高資産まで伸ばす試合が多い";
    case "high_risk_breakthrough":
      return "低資産と上位が同居する";
    case "steady_accumulator":
      return "低資産で終える試合が少ない";
    case "balanced":
      return "資産帯の偏りが小さい";
    default:
      return "傾向を判定できません";
  }
}

export function assetShapeLabel(value: string | null): string {
  switch (value) {
    case "wide":
      return "高い試合と低い試合の幅が広めです。";
    case "compact":
      return "試合ごとの資産帯が比較的まとまっています。";
    default:
      return "資産帯の広がりを判定できません。";
  }
}

export function assetEvidenceLabel(kind: string): string {
  switch (kind) {
    case "high_asset_rate":
      return "高資産で終えた割合";
    case "low_asset_rate":
      return "低資産で終えた割合";
    case "win_rate":
      return "勝率";
    default:
      return "戦績上の根拠";
  }
}

export function assetEvidenceToneLabel(tone: "neutral" | "risk" | "strength"): string {
  switch (tone) {
    case "strength":
      return "強み";
    case "risk":
      return "注意";
    case "neutral":
      return "根拠";
  }
}
