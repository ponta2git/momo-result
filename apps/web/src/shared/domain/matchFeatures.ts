export const matchFeatureIds = [
  "close_finish",
  "asset_blowout",
  "revenue_top_no_win",
  "ginji_storm",
  "negative_assets",
  "no_destination",
  "destination_burst",
  "low_revenue_win",
  "fourth_order_win",
] as const;

export type MatchFeatureId = (typeof matchFeatureIds)[number];
export type MatchFeatureSource = "match" | "series";
export type MatchFeatureTone = "neutral" | "notice";

export type MatchFeatureDefinition = {
  description: string;
  id: MatchFeatureId;
  label: string;
  tone: MatchFeatureTone;
};

export const maxMatchFeatureBadges = 6;

export const seriesRelativeMatchFeatureIds = ["close_finish", "asset_blowout"] as const;

const matchFeatureDefinitions = {
  close_finish: {
    description: "1位と2位の総資産差が、同作品内の接戦側に入った試合です。",
    id: "close_finish",
    label: "接戦",
    tone: "neutral",
  },
  asset_blowout: {
    description: "1位と4位の総資産差が、同作品内の大差側に入った試合です。",
    id: "asset_blowout",
    label: "大差",
    tone: "notice",
  },
  revenue_top_no_win: {
    description: "物件収益トップの社長が最終1位ではなかった試合です。",
    id: "revenue_top_no_win",
    label: "物件収益ねじれ",
    tone: "notice",
  },
  ginji_storm: {
    description: "スリの銀次が試合内で合計2回以上発生した試合です。",
    id: "ginji_storm",
    label: "スリの銀次多発",
    tone: "notice",
  },
  negative_assets: {
    description: "総資産がマイナスの社長がいた試合です。",
    id: "negative_assets",
    label: "借金あり",
    tone: "notice",
  },
  no_destination: {
    description: "全社長の目的地到着数が0回だった試合です。",
    id: "no_destination",
    label: "目的地なし決着",
    tone: "neutral",
  },
  destination_burst: {
    description: "全社長の目的地到着数が合計4回以上だった試合です。",
    id: "destination_burst",
    label: "目的地ラッシュ",
    tone: "neutral",
  },
  low_revenue_win: {
    description: "優勝社長の物件収益順位が3位以下だった試合です。",
    id: "low_revenue_win",
    label: "低収益勝ち",
    tone: "neutral",
  },
  fourth_order_win: {
    description: "4番手の社長が優勝した試合です。",
    id: "fourth_order_win",
    label: "4番手勝利",
    tone: "neutral",
  },
} satisfies Record<MatchFeatureId, MatchFeatureDefinition>;

const matchFeaturePriorities = new Map<MatchFeatureId, number>(
  matchFeatureIds.map((id, index) => [id, index]),
);

const matchFeatureIdSet = new Set<string>(matchFeatureIds);

export function isMatchFeatureId(value: string): value is MatchFeatureId {
  return matchFeatureIdSet.has(value);
}

export function matchFeatureDefinition(id: MatchFeatureId): MatchFeatureDefinition {
  return matchFeatureDefinitions[id];
}

export function matchFeatureLabel(id: string): string {
  return isMatchFeatureId(id) ? matchFeatureDefinition(id).label : id;
}

export function matchFeaturePriority(id: MatchFeatureId): number {
  return matchFeaturePriorities.get(id) ?? matchFeatureIds.length;
}
