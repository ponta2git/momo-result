export function assetStyleLabel(value: string | null): string {
  switch (value) {
    case "asset_explosion":
      return "高資産まで伸ばす試合が多い";
    case "high_risk_breakthrough":
      return "低資産と上位が同居する";
    case "close_collector":
      return "接戦を拾って上位へ届く";
    case "steady_accumulator":
      return "低資産で終える試合が少ない";
    case "upper_chaser":
      return "2位圏へ追い上げる試合が多い";
    case "balanced":
      return "資産帯の偏りが小さい";
    default:
      return "傾向を判定できません";
  }
}

export function assetShapeLabel(value: string | null): string {
  switch (value) {
    case "two_tailed":
      return "高資産と低資産の両側へ広がっています。";
    case "upper_side":
      return "低資産を避け、高資産側へ寄っています。";
    case "lower_tail":
      return "低資産側へ裾が伸びています。";
    case "thin_right_tail":
      return "高資産側の突出が少ない分布です。";
    case "right_tail":
      return "一部の試合が高資産側へ伸びています。";
    case "middle_heavy":
      return "中央の資産帯へ集まっています。";
    default:
      return "資産帯の広がりを判定できません。";
  }
}

export function assetTagLabel(value: string): string {
  switch (value) {
    case "high_variance":
      return "振れ幅大";
    case "mobility_collecting":
      return "目的地を重ねる";
    case "upper_chaser":
      return "2位追走";
    case "property_base":
      return "物件基盤";
    case "downside_risk":
      return "下振れ注意";
    case "card_base":
      return "カード寄り";
    case "close_finish":
      return "接戦型";
    default:
      return "補助傾向";
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
