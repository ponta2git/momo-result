import { formatManYen } from "@/shared/lib/formatters";

/** Display vocabulary shared by the public comparison and administrator's preview. */
export const playerRadarAxes = [
  {
    id: "averageRank",
    label: "平均順位",
    chartLabel: ["平均順位"],
    description: "対象試合の順位の平均。小さいほど好成績です。",
  },
  {
    id: "revenueP90",
    label: "収益の高い側",
    chartLabel: ["収益の", "高い側"],
    description: "物件収益のP90。小さい順の90%の位置にある境界で、最高額ではありません。",
  },
  {
    id: "revenueAverage",
    label: "平均物件収益",
    chartLabel: ["平均", "物件収益"],
    description: "対象試合の物件収益の平均。大きな収益の試合も影響します。",
  },
  {
    id: "totalAssetsP10",
    label: "資産の低い側",
    chartLabel: ["資産の低い側"],
    description:
      "総資産のP10。小さい順の10%の位置にある境界で、下位だった試合だけの値ではありません。",
  },
  {
    id: "totalAssetsMedian",
    label: "資産の真ん中",
    chartLabel: ["資産の", "真ん中"],
    description: "総資産の中央値。全試合の真ん中の水準で、偶数件では中央2値の平均です。",
  },
  {
    id: "totalAssetsP90",
    label: "資産の高い側",
    chartLabel: ["資産の", "高い側"],
    description:
      "総資産のP90。小さい順の90%の位置にある境界で、勝利した試合だけの値ではありません。",
  },
] as const;

export type PlayerRadarAxisId = (typeof playerRadarAxes)[number]["id"];
export type PlayerRadarSampleQuality = "no_target" | "insufficient" | "reference" | "standard";
export type PlayerRadarUnavailableReason =
  | "no_target"
  | "insufficient_matches"
  | "basis_unavailable";

export type PlayerRadarCell = {
  axisId: PlayerRadarAxisId;
  rawValue: number | null;
  score: number | null;
  sampleQuality: PlayerRadarSampleQuality;
  scoreUnavailableReasons: readonly PlayerRadarUnavailableReason[];
};

export type PlayerRadarPlayer = {
  memberId: string;
  displayName: string;
  axes: readonly PlayerRadarCell[];
};

export type PlayerRadarSample = {
  matchCount: number;
  heldEventCount: number;
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
  maps: ReadonlyArray<{ mapMasterId: string; displayName: string; matchCount: number }>;
};

export type PlayerRadarBasis = {
  basisId: string;
  createdAt: string | null;
  appliedAt: string | null;
  methodVersion: string;
  definitionVersion: string;
  source: PlayerRadarSample;
  axes: ReadonlyArray<{
    axisId: PlayerRadarAxisId;
    thresholds: ReadonlyArray<{ score: number; rawValue: number }>;
  }>;
};

export type PlayerRadarDisplay = {
  basis: PlayerRadarBasis | null;
  sample: PlayerRadarSample & { quality: PlayerRadarSampleQuality };
  players: readonly PlayerRadarPlayer[];
};

const rankFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const boundaryFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 10 });

export function formatPlayerRadarRawValue(axisId: PlayerRadarAxisId, value: number | null) {
  if (value === null) return "—";
  return axisId === "averageRank" ? `${rankFormatter.format(value)}位` : formatManYen(value);
}

export function formatPlayerRadarBoundary(axisId: PlayerRadarAxisId, value: number) {
  return `${boundaryFormatter.format(value)}${axisId === "averageRank" ? "位以下" : "万円以上"}`;
}

export function playerRadarScoreLabel(cell: PlayerRadarCell | undefined): string {
  if (!cell) return "未採点";
  if (cell.score !== null) return `${cell.score}点`;
  return cell.scoreUnavailableReasons.includes("no_target") ? "対象なし" : "未採点";
}

export function playerRadarUnavailableLabel(reason: PlayerRadarUnavailableReason): string {
  switch (reason) {
    case "no_target":
      return "対象試合なし";
    case "insufficient_matches":
      return "3試合未満";
    case "basis_unavailable":
      return "基準未作成";
  }
}
