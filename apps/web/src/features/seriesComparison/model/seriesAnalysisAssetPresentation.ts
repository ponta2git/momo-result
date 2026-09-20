const assetStyleLabels = new Map([
  ["asset_explosion", "高資産まで伸ばす試合が多い"],
  ["high_risk_breakthrough", "低資産と上位が同居する"],
  ["close_collector", "接戦時の上位率が高い"],
  ["steady_accumulator", "低資産で終える試合が少ない"],
  ["upper_chaser", "2位圏へ追い上げる試合が多い"],
  ["balanced", "資産帯の偏りが小さい"],
]);

export function assetStyleLabel(value: string | null): string {
  return assetStyleLabels.get(value ?? "") ?? "傾向を判定できません";
}

const assetShapeLabels = new Map([
  ["two_tailed", "高資産と低資産の両側へ広がっています。"],
  ["upper_side", "低資産の試合が少なく、高資産側に分布しています。"],
  ["lower_tail", "低資産側へ裾が伸びています。"],
  ["thin_right_tail", "高資産側の突出が少ない分布です。"],
  ["right_tail", "一部の試合が高資産側へ伸びています。"],
  ["middle_heavy", "中央の資産帯へ集まっています。"],
]);

export function assetShapeLabel(value: string | null): string {
  return assetShapeLabels.get(value ?? "") ?? "資産帯の広がりを判定できません。";
}

const assetTagLabels = new Map([
  ["high_variance", "振れ幅大"],
  ["mobility_collecting", "目的地到着回数が多い"],
  ["upper_chaser", "2位追走"],
  ["property_base", "物件基盤"],
  ["downside_risk", "下振れ注意"],
  ["card_base", "カード寄り"],
  ["close_finish", "接戦型"],
]);

export function assetTagLabel(value: string): string {
  return assetTagLabels.get(value) ?? "補助傾向";
}

const assetEvidenceLabels = new Map([
  ["high_asset_rate", "高資産で終えた割合"],
  ["low_asset_rate", "低資産で終えた割合"],
  ["win_rate", "勝率"],
]);

export function assetEvidenceLabel(kind: string): string {
  return assetEvidenceLabels.get(kind) ?? "戦績上の根拠";
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
