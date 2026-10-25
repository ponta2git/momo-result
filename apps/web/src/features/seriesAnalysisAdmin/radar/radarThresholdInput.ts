import {
  playerRadarAxes,
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
  achievementCurve?: Extract<PlayerAchievementCurve, { pointThresholds: readonly number[] }>;
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
    ...(basis.achievementCurve && "pointThresholds" in basis.achievementCurve
      ? { achievementCurve: basis.achievementCurve }
      : {}),
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
    ["achievement", input.achievementCurve?.pointThresholds.map(String) ?? []],
  ]) as Record<PlayerRadarSettingAxisId, string[]>;
}

/** Parse the entire visible string; never strip decimal points, signs, or invalid characters. */
export function parseRadarThresholdDrafts(drafts: RadarThresholdDrafts): {
  input: RadarManualInput | null;
  errors: RadarThresholdError[];
} {
  const errors: RadarThresholdError[] = [];
  function parseAxis(
    axisId: PlayerRadarSettingAxisId,
    texts: readonly string[] | undefined,
  ): number[] {
    const descending = axisId === "averageRank";
    const unit = descending ? "位" : axisId === "achievement" ? "pt" : "万円";
    const thresholds = Array.from({ length: 9 }, (_, index) => {
      const text = texts?.[index]?.trim() ?? "";
      const value = Number(text);
      if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text) ||
        !Number.isFinite(value)
      ) {
        errors.push({
          axisId,
          index,
          kind: "numeric",
          message:
            axisId === "achievement"
              ? "実績ポイントを最後まで入力してください。"
              : "数値を最後まで入力してください。",
        });
        return NaN;
      }
      if (axisId === "achievement" && (value < 0 || value > 102400)) {
        errors.push({
          axisId,
          index,
          kind: "range",
          message: `${index + 2}点の境界は0〜102400ptで入力してください。`,
        });
      }
      return value;
    });
    if (texts?.length !== 9) {
      errors.push({
        axisId,
        index: 0,
        kind: "numeric",
        message: "2〜10点の9境界を入力してください。",
      });
    }
    for (let index = 1; index < thresholds.length; index += 1) {
      const previous = thresholds[index - 1] ?? NaN;
      const current = thresholds[index] ?? NaN;
      if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
      if (descending ? current >= previous : current <= previous) {
        errors.push(
          {
            axisId,
            index: index - 1,
            kind: "order",
            message: `${index + 2}点の境界（${current}${unit}）より${descending ? "大きい" : "小さい"}値にしてください。`,
          },
          {
            axisId,
            index,
            kind: "order",
            message: `${index + 1}点の境界（${previous}${unit}）より${descending ? "小さい" : "大きい"}値にしてください。`,
          },
        );
      }
    }
    if (descending && (thresholds[8] ?? NaN) < 1) {
      errors.push({
        axisId,
        index: 8,
        kind: "range",
        message: "10点の境界は1位以上にしてください。",
      });
    }
    return thresholds;
  }
  const axes = playerRadarAxes.map(({ id }) => ({
    axisId: id,
    thresholds: parseAxis(id, drafts[id]),
  }));
  // Empty point drafts deliberately inherit an unavailable or historical percentage curve.
  const achievementCurve =
    drafts.achievement.length === 0
      ? undefined
      : { pointThresholds: parseAxis("achievement", drafts.achievement) };
  return {
    input: errors.length > 0 ? null : { axes, ...(achievementCurve ? { achievementCurve } : {}) },
    errors,
  };
}

export function sameRadarThresholds(a: RadarManualInput, b: RadarManualInput): boolean {
  const leftCurve = a.achievementCurve?.pointThresholds ?? [];
  const rightCurve = b.achievementCurve?.pointThresholds ?? [];
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
  input: { axes: RadarManualInput["axes"]; achievementCurve?: PlayerAchievementCurve },
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
  const achievementCurve =
    input.achievementCurve ?? basis.achievementCurve ?? defaultAchievementCurve;
  return {
    ...evaluation,
    basis: radarInputBasis(basis, input),
    achievementCurve,
    players: evaluation.players.map((player) => ({
      ...player,
      ...(player.achievement
        ? {
            achievement: {
              ...player.achievement,
              score: achievementRadarScore(player.achievement, achievementCurve),
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
