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

export const playerAchievementAxis = {
  id: "achievement",
  label: "実績達成",
  chartLabel: ["実績達成", "作品通算"],
  description: "対象の実績に対する作品通算の獲得ポイント。",
} as const;

export const playerRadarSettingAxes = [...playerRadarAxes, playerAchievementAxis] as const;
export type PlayerRadarSettingAxisId = (typeof playerRadarSettingAxes)[number]["id"];
export const achievementScorePoints = [1, 3, 5, 7, 10] as const;
export type PlayerAchievementCurve =
  | { thresholds: readonly number[] }
  | { pointThresholds: readonly number[] }
  | {
      unavailableReason: "basis_unavailable" | "no_target" | "degenerate_distribution";
    };
export const defaultAchievementCurve: PlayerAchievementCurve = { thresholds: [0, 10, 25, 50, 80] };

export function achievementCurveThresholds(curve: PlayerAchievementCurve) {
  return "pointThresholds" in curve
    ? curve.pointThresholds.map((rawValue, index) => ({ score: index + 2, rawValue }))
    : "thresholds" in curve
      ? curve.thresholds.map((rawValue, index) => ({
          score: achievementScorePoints[index] ?? 10,
          rawValue,
        }))
      : [];
}

export function achievementCurveUnit(curve: PlayerAchievementCurve) {
  return "pointThresholds" in curve
    ? "pt以上"
    : "thresholds" in curve
      ? "%（従来の得点率）"
      : "基準未生成";
}

/** Already calculated by the publication; the chart never recalculates this score. */
export type PlayerAchievementScore = {
  earnedPoints: number;
  totalPoints: number;
  score: number | null;
};

export function playerAchievementScoreLabel(value: PlayerAchievementScore): string {
  return value.score !== null
    ? `${formatDecimal(value.score)}点`
    : value.totalPoints === 0
      ? "採点対象外"
      : "基準未適用";
}
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
  achievement?: PlayerAchievementScore;
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
  achievementCurve?: PlayerAchievementCurve;
  source: PlayerRadarSample;
  axes: ReadonlyArray<{
    axisId: PlayerRadarAxisId;
    thresholds: ReadonlyArray<{ score: number; rawValue: number }>;
  }>;
};

export type PlayerRadarDisplay = {
  basis: PlayerRadarBasis | null;
  achievementCurve?: PlayerAchievementCurve;
  sample: PlayerRadarSample & { quality: PlayerRadarSampleQuality };
  players: readonly PlayerRadarPlayer[];
};

export function playerRadarAchievementCurve(
  display: PlayerRadarDisplay | null,
): PlayerAchievementCurve {
  return (
    display?.achievementCurve ??
    display?.basis?.achievementCurve ??
    (display?.basis ? defaultAchievementCurve : { unavailableReason: "basis_unavailable" })
  );
}

export function playerRadarScoresAreReference(players: readonly PlayerRadarPlayer[]): boolean {
  const scores = players.flatMap((player) => player.axes).filter((cell) => cell.score !== null);
  return scores.length > 0 && scores.every((cell) => cell.sampleQuality === "reference");
}

export function formatPlayerRadarRawValue(axisId: PlayerRadarSettingAxisId, value: number | null) {
  if (value === null) return "—";
  if (axisId === "achievement") return `${formatDecimal(value)}pt`;
  return axisId === "averageRank" ? `${formatDecimal(value)}位` : formatManYen(value);
}

export function playerRadarSettingThresholds(
  basis: PlayerRadarBasis | null | undefined,
  axisId: PlayerRadarSettingAxisId,
) {
  return axisId === "achievement"
    ? basis
      ? achievementCurveThresholds(basis.achievementCurve ?? defaultAchievementCurve)
      : []
    : (basis?.axes.find((axis) => axis.axisId === axisId)?.thresholds ?? []);
}

export function playerRadarSettingCell(
  player: PlayerRadarPlayer | null | undefined,
  axisId: PlayerRadarSettingAxisId,
): (Omit<PlayerRadarCell, "axisId"> & { axisId: PlayerRadarSettingAxisId }) | undefined {
  if (axisId !== "achievement") return player?.axes.find((cell) => cell.axisId === axisId);
  const score = player?.achievement;
  if (!score) return undefined;
  return {
    axisId,
    rawValue: score.totalPoints > 0 ? score.earnedPoints : null,
    score: score.score,
    sampleQuality: "standard",
    scoreUnavailableReasons:
      score.totalPoints === 0 ? ["no_target"] : score.score === null ? ["basis_unavailable"] : [],
  };
}

/** Rescore published points; historical percentage curves retain their original meaning. */
export function achievementRadarScore(
  points: Pick<PlayerAchievementScore, "earnedPoints" | "totalPoints">,
  curve: PlayerAchievementCurve,
): number | null {
  if (points.totalPoints === 0 || "unavailableReason" in curve) return null;
  if ("pointThresholds" in curve) {
    return 1 + curve.pointThresholds.filter((threshold) => points.earnedPoints >= threshold).length;
  }
  const percentage = (100 * points.earnedPoints) / points.totalPoints;
  const thresholds = curve.thresholds;
  if (percentage <= (thresholds[0] ?? 0)) return 1;
  for (let index = 1; index < thresholds.length; index += 1) {
    const high = thresholds[index] ?? 100;
    const low = thresholds[index - 1] ?? 0;
    if (percentage <= high) {
      const lowScore = achievementScorePoints[index - 1] ?? 1;
      return (
        lowScore +
        ((percentage - low) / (high - low)) * ((achievementScorePoints[index] ?? 10) - lowScore)
      );
    }
  }
  return 10;
}

export function formatPlayerRadarBoundary(axisId: PlayerRadarAxisId, value: number) {
  const rounded =
    axisId === "averageRank" ? Number(formatDecimal(value).replaceAll(",", "")) : Math.round(value);
  const approximate = rounded === value ? "" : "約";
  return `${approximate}${formatPlayerRadarRawValue(axisId, value)}${axisId === "averageRank" ? "以下" : "以上"}`;
}

export function playerRadarScoreLabel(
  cell: Pick<PlayerRadarCell, "score" | "scoreUnavailableReasons"> | undefined,
): string {
  if (!cell) return "未採点";
  if (cell.score !== null) return `${formatDecimal(cell.score)}点`;
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
