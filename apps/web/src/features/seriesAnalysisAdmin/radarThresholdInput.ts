import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";
import type {
  PlayerRadarAxisId,
  PlayerRadarBasis,
  PlayerRadarDisplay,
} from "@/shared/seriesAnalysis/playerRadarPresentation";

export type RadarManualInput = {
  axes: Array<{ axisId: PlayerRadarAxisId; thresholds: number[] }>;
};
export type RadarThresholdDrafts = Readonly<Record<PlayerRadarAxisId, readonly string[]>>;
export type RadarThresholdError = {
  axisId: PlayerRadarAxisId;
  index: number;
  kind: "numeric" | "order" | "range";
  message: string;
};

export function radarBasisInput(basis: PlayerRadarBasis): RadarManualInput {
  return {
    axes: playerRadarAxes.map(({ id }) => ({
      axisId: id,
      thresholds:
        basis.axes.find((axis) => axis.axisId === id)?.thresholds.map((v) => v.rawValue) ?? [],
    })),
  };
}

export function radarThresholdDrafts(input: RadarManualInput): RadarThresholdDrafts {
  return Object.fromEntries(
    input.axes.map((axis) => [axis.axisId, axis.thresholds.map(String)]),
  ) as Record<PlayerRadarAxisId, string[]>;
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
  return { input: errors.length > 0 ? null : { axes }, errors };
}

export function sameRadarThresholds(a: RadarManualInput, b: RadarManualInput): boolean {
  return playerRadarAxes.every(({ id }) => {
    const left = a.axes.find((axis) => axis.axisId === id)?.thresholds;
    const right = b.axes.find((axis) => axis.axisId === id)?.thresholds;
    return (
      left?.length === 9 && right?.length === 9 && left.every((value, i) => value === right[i])
    );
  });
}

export function radarInputBasis(
  basis: PlayerRadarBasis,
  input: RadarManualInput,
): PlayerRadarBasis {
  return {
    ...basis,
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
    players: evaluation.players.map((player) => ({
      ...player,
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
