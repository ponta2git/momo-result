import {
  playerRadarAxes,
  defaultAchievementPointCurve,
  defaultAchievementCurve,
  achievementRadarScore,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import type {
  PlayerAchievementCurve,
  PlayerRadarAxisId,
  PlayerRadarSettingAxisId,
  PlayerRadarBasis,
  PlayerRadarDisplay,
} from "@/shared/seriesAnalysis/playerRadarPresentation";

export type RadarManualInput = {
  axes: Array<{ axisId: PlayerRadarAxisId; thresholds: number[] }>;
  achievementCurve?: PlayerAchievementCurve;
};
export type RadarThresholdDrafts = Readonly<Record<PlayerRadarSettingAxisId, readonly string[]>>;
export type RadarThresholdError = {
  axisId: PlayerRadarSettingAxisId;
  index: number;
  kind: "numeric" | "order" | "range";
  message: string;
};

export function radarBasisInput(basis: PlayerRadarBasis): RadarManualInput {
  return {
    achievementCurve: basis.achievementCurve ?? defaultAchievementCurve,
    axes: playerRadarAxes.map(({ id }) => ({
      axisId: id,
      thresholds:
        basis.axes.find((axis) => axis.axisId === id)?.thresholds.map((v) => v.rawValue) ?? [],
    })),
  };
}

export function radarThresholdDrafts(input: RadarManualInput): RadarThresholdDrafts {
  return Object.fromEntries([
    ...input.axes.map((axis) => [axis.axisId, axis.thresholds.map(String)]),
    [
      "achievement",
      (input.achievementCurve && "pointThresholds" in input.achievementCurve
        ? input.achievementCurve.pointThresholds
        : defaultAchievementPointCurve.pointThresholds
      ).map(String),
    ],
  ]) as Record<PlayerRadarSettingAxisId, string[]>;
}

/** Parse the entire visible string; never strip decimal points, signs, or invalid characters. */
export function parseRadarThresholdDrafts(drafts: RadarThresholdDrafts): {
  input: RadarManualInput | null;
  errors: RadarThresholdError[];
} {
  const errors: RadarThresholdError[] = [];
  const axes = playerRadarAxes.map(({ id }) => {
    const texts = drafts[id];
    const thresholds = Array.from({ length: 9 }, (_, index) => {
      const text = texts?.[index]?.trim() ?? "";
      const value = Number(text);
      if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text) ||
        !Number.isFinite(value)
      ) {
        errors.push({
          axisId: id,
          index,
          kind: "numeric",
          message: "数値を最後まで入力してください。",
        });
        return NaN;
      }
      return value;
    });
    if (texts?.length !== 9) {
      errors.push({
        axisId: id,
        index: 0,
        kind: "numeric",
        message: "2〜10点の9境界を入力してください。",
      });
    }
    for (let index = 1; index < thresholds.length; index += 1) {
      const previous = thresholds[index - 1] ?? NaN;
      const current = thresholds[index] ?? NaN;
      if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
      if (id === "averageRank" ? current >= previous : current <= previous) {
        const unit = id === "averageRank" ? "位" : "万円";
        errors.push(
          {
            axisId: id,
            index: index - 1,
            kind: "order",
            message: `${index + 2}点の境界（${current}${unit}）より${id === "averageRank" ? "大きい" : "小さい"}値にしてください。`,
          },
          {
            axisId: id,
            index,
            kind: "order",
            message: `${index + 1}点の境界（${previous}${unit}）より${id === "averageRank" ? "小さい" : "大きい"}値にしてください。`,
          },
        );
      }
    }
    if (id === "averageRank" && (thresholds[8] ?? NaN) < 1) {
      errors.push({
        axisId: id,
        index: 8,
        kind: "range",
        message: "10点の境界は1位以上にしてください。",
      });
    }
    return { axisId: id, thresholds };
  });
  const curveTexts = drafts.achievement;
  const curveThresholds = Array.from({ length: 9 }, (_, index) => {
    const score = index + 2;
    const text = curveTexts?.[index]?.trim() ?? "";
    const value = Number(text);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text) || !Number.isFinite(value)) {
      errors.push({
        axisId: "achievement",
        index,
        kind: "numeric",
        message: "実績ポイントを最後まで入力してください。",
      });
    } else if (value < 0 || value > 102400) {
      errors.push({
        axisId: "achievement",
        index,
        kind: "range",
        message: `${score}点の境界は0〜102400ptで入力してください。`,
      });
    }
    return value;
  });
  if (curveTexts?.length !== 9)
    errors.push({
      axisId: "achievement",
      index: 0,
      kind: "numeric",
      message: "2〜10点の9境界を入力してください。",
    });
  for (let index = 1; index < curveThresholds.length; index += 1) {
    const previous = curveThresholds[index - 1] ?? NaN;
    const current = curveThresholds[index] ?? NaN;
    if (Number.isFinite(previous) && Number.isFinite(current) && current <= previous) {
      errors.push(
        {
          axisId: "achievement",
          index: index - 1,
          kind: "order",
          message: `${index + 2}点の境界（${current}pt）より小さい値にしてください。`,
        },
        {
          axisId: "achievement",
          index,
          kind: "order",
          message: `${index + 1}点の境界（${previous}pt）より大きい値にしてください。`,
        },
      );
    }
  }
  return {
    input:
      errors.length > 0 ? null : { axes, achievementCurve: { pointThresholds: curveThresholds } },
    errors,
  };
}

export function sameRadarThresholds(a: RadarManualInput, b: RadarManualInput): boolean {
  const leftPolicy = a.achievementCurve ?? defaultAchievementCurve;
  const rightPolicy = b.achievementCurve ?? defaultAchievementCurve;
  if ("pointThresholds" in leftPolicy !== "pointThresholds" in rightPolicy) return false;
  const leftCurve =
    "pointThresholds" in leftPolicy ? leftPolicy.pointThresholds : leftPolicy.thresholds;
  const rightCurve =
    "pointThresholds" in rightPolicy ? rightPolicy.pointThresholds : rightPolicy.thresholds;
  return (
    leftCurve.length === rightCurve.length &&
    leftCurve.every((value, index) => value === rightCurve[index]) &&
    playerRadarAxes.every(({ id }) => {
      const left = a.axes.find((axis) => axis.axisId === id)?.thresholds;
      const right = b.axes.find((axis) => axis.axisId === id)?.thresholds;
      return (
        left?.length === 9 && right?.length === 9 && left.every((value, i) => value === right[i])
      );
    })
  );
}

export function radarInputBasis(
  basis: PlayerRadarBasis,
  input: RadarManualInput,
): PlayerRadarBasis {
  return {
    ...basis,
    achievementCurve: input.achievementCurve ?? basis.achievementCurve ?? defaultAchievementCurve,
    axes: input.axes.map((axis) => ({
      axisId: axis.axisId,
      thresholds: axis.thresholds.map((rawValue, index) => ({ score: index + 2, rawValue })),
    })),
  };
}

/** Only rescoring saved raw metrics is allowed here; sample eligibility remains server-owned. */
export function previewRadarThresholds(
  evaluation: PlayerRadarDisplay,
  basis: PlayerRadarBasis,
  input: RadarManualInput,
): PlayerRadarDisplay {
  return {
    ...evaluation,
    basis: radarInputBasis(basis, input),
    achievementCurve: input.achievementCurve ?? basis.achievementCurve ?? defaultAchievementCurve,
    players: evaluation.players.map((player) => ({
      ...player,
      ...(player.achievement
        ? {
            achievement: {
              ...player.achievement,
              score: achievementRadarScore(
                player.achievement,
                input.achievementCurve ?? defaultAchievementCurve,
              ),
            },
          }
        : {}),
      axes: player.axes.map((cell) => {
        const thresholds = input.axes.find((axis) => axis.axisId === cell.axisId)?.thresholds;
        if (!thresholds || thresholds.length !== 9) return { ...cell };
        // Valid entered criteria supply the missing basis only for the after comparison.
        const scoreUnavailableReasons = cell.scoreUnavailableReasons.filter(
          (reason) => reason !== "basis_unavailable",
        );
        if (cell.rawValue === null || scoreUnavailableReasons.length > 0)
          return { ...cell, score: null, scoreUnavailableReasons };
        const raw = cell.rawValue;
        const score =
          1 +
          thresholds.filter((value) =>
            cell.axisId === "averageRank" ? raw <= value : raw >= value,
          ).length;
        return { ...cell, score, scoreUnavailableReasons };
      }),
    })),
  };
}
