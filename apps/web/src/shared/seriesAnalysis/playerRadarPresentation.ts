import { formatDecimal, formatManYen } from "@/shared/lib/formatters";

/** Display vocabulary shared by the public comparison and administrator's preview. */
export const playerRadarAxes = [
  {
    id: "averageRank",
    label: "平均順位",
    chartLabel: ["平均順位"],
    description: "対象試合の順位の平均。",
  },
  {
    id: "revenueP90",
    label: "物件収益（高め）",
    chartLabel: ["物件収益", "高め"],
    description: "物件収益を小さい順に並べた90%の位置（P90）。",
  },
  {
    id: "revenueAverage",
    label: "平均物件収益",
    chartLabel: ["平均", "物件収益"],
    description: "対象試合の物件収益の平均。",
  },
  {
    id: "totalAssetsP10",
    label: "総資産（低め）",
    chartLabel: ["総資産", "低め"],
    description: "総資産を小さい順に並べた10%の位置（P10）。",
  },
  {
    id: "totalAssetsMedian",
    label: "総資産（中央）",
    chartLabel: ["総資産", "中央"],
    description: "総資産の中央値。偶数件は中央2値の平均。",
  },
  {
    id: "totalAssetsP90",
    label: "総資産（高め）",
    chartLabel: ["総資産", "高め"],
    description: "総資産を小さい順に並べた90%の位置（P90）。",
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

export function playerRadarScoresAreReference(players: readonly PlayerRadarPlayer[]): boolean {
  const scores = players.flatMap((player) => player.axes).filter((cell) => cell.score !== null);
  return scores.length > 0 && scores.every((cell) => cell.sampleQuality === "reference");
}

export function formatPlayerRadarRawValue(axisId: PlayerRadarAxisId, value: number | null) {
  if (value === null) return "—";
  return axisId === "averageRank" ? `${formatDecimal(value)}位` : formatManYen(value);
}

export function formatPlayerRadarBoundary(axisId: PlayerRadarAxisId, value: number) {
  const rounded =
    axisId === "averageRank" ? Number(formatDecimal(value).replaceAll(",", "")) : Math.round(value);
  const approximate = rounded === value ? "" : "約";
  return `${approximate}${formatPlayerRadarRawValue(axisId, value)}${axisId === "averageRank" ? "以下" : "以上"}`;
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
      return "基準未適用";
  }
}
