import { describe, expect, it } from "vitest";

import {
  parseRadarThresholdDrafts,
  previewRadarThresholds,
  radarBasisInput,
  radarThresholdDrafts,
  sameRadarThresholds,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import type { RadarManualInput } from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import {
  playerRadarBasisDisplay,
  playerRadarEvaluationDisplay,
} from "@/shared/seriesAnalysis/playerRadarDisplay";
import {
  playerRadarAxes,
  defaultAchievementCurve,
  achievementRadarScore,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import { makePlayerRadarBasis, makePlayerRadarEvaluation } from "@/test/msw/playerRadarFixtures";

import manualFixture from "../../../../../../docs/schemas/fixtures/series-analysis/radar-manual-scoring-v1.json";

function validInput(): RadarManualInput {
  return {
    axes: playerRadarAxes.map(({ id }) => ({
      axisId: id,
      thresholds:
        id === "averageRank"
          ? [5, 4, 3.5, 3, 2.75, 2.5, 2, 1.5, 1]
          : [-40, -30, -20, -10, 0, 10, 20, 30, 40],
    })),
  };
}

describe("radar threshold editing", () => {
  it("scores achievement percentages through the five points independently of the six-axis eligibility", () => {
    for (const [earnedPoints, score] of [
      [0, 1],
      [5, 2],
      [10, 3],
      [25, 5],
      [50, 7],
      [65, 8.5],
      [80, 10],
      [100, 10],
    ]) {
      expect(
        achievementRadarScore(
          { earnedPoints: earnedPoints!, totalPoints: 100 },
          defaultAchievementCurve,
        ),
      ).toBe(score);
    }
    expect(
      achievementRadarScore({ earnedPoints: 0, totalPoints: 0 }, defaultAchievementCurve),
    ).toBeNull();
    const basis = playerRadarBasisDisplay(makePlayerRadarBasis(), []);
    const before = playerRadarEvaluationDisplay(makePlayerRadarEvaluation(), basis, []);
    before.players[0]!.achievement = { earnedPoints: 50, totalPoints: 100, score: 7 };
    before.players[0]!.axes[0]!.score = null;
    before.players[0]!.axes[0]!.scoreUnavailableReasons = ["insufficient_matches"];
    const input = {
      ...radarBasisInput(basis),
      achievementCurve: { thresholds: [0, 20, 40, 60, 90] },
    };
    const after = previewRadarThresholds(before, basis, input);
    expect(after.players[0]!.achievement).toEqual({ earnedPoints: 50, totalPoints: 100, score: 6 });
    expect(after.players[0]!.axes).toEqual(before.players[0]!.axes);
    expect(before.players[0]!.achievement.score).toBe(7);
    expect(sameRadarThresholds(input, radarBasisInput(basis))).toBe(false);
  });

  it.each([
    ["0", "10", "10", "50", "80"],
    ["0", "30", "25", "50", "80"],
    ["-1", "10", "25", "50", "80"],
    ["0", "10", "25", "50", "101"],
    ["0", "", "25", "50", "80"],
    ["0", "Infinity", "25", "50", "80"],
  ])("rejects invalid achievement points %j without accepting an old curve", (...achievement) => {
    const parsed = parseRadarThresholdDrafts({
      ...radarThresholdDrafts(validInput()),
      achievement,
    });
    expect(parsed.input).toBeNull();
    expect(parsed.errors.some((error) => error.axisId === "achievement")).toBe(true);
  });

  it("matches the Rust shared scoring fixture at equality and adjacent floating-point boundaries", () => {
    const basis = playerRadarBasisDisplay(makePlayerRadarBasis(), []);
    const input = manualFixture.input as RadarManualInput;
    expect(parseRadarThresholdDrafts(radarThresholdDrafts(input)).input).toEqual({
      ...input,
      achievementCurve: input.achievementCurve ?? defaultAchievementCurve,
    });
    for (const entry of manualFixture.cases) {
      const raw = makePlayerRadarEvaluation();
      const cell = raw.players[0]?.axes.find((axis) => axis.axisId === entry.axisId);
      if (!cell) throw new Error(`Missing fixture axis ${entry.axisId}`);
      cell.rawValue = entry.rawValue;
      cell.scoreUnavailableReasons = [];
      const after = previewRadarThresholds(
        playerRadarEvaluationDisplay(raw, basis, []),
        basis,
        input,
      );
      expect(after.players[0]?.axes.find((axis) => axis.axisId === entry.axisId)?.score).toBe(
        entry.score,
      );
    }
  });

  it("scores the first after comparison without inventing before scores or removing sample restrictions", () => {
    const basis = playerRadarBasisDisplay(makePlayerRadarBasis(), []);
    const raw = makePlayerRadarEvaluation();
    for (const player of raw.players) {
      for (const cell of player.axes) {
        cell.score = null;
        cell.scoreUnavailableReasons = ["basis_unavailable"];
      }
    }
    const insufficient = raw.players[0]?.axes[1];
    if (!insufficient) throw new Error("Missing sample fixture");
    insufficient.scoreUnavailableReasons = ["insufficient_matches", "basis_unavailable"];
    const before = playerRadarEvaluationDisplay(raw, null, []);
    const after = previewRadarThresholds(before, basis, validInput());
    expect(before.players[0]?.axes[0]?.score).toBeNull();
    expect(before.players[0]?.axes[0]?.scoreUnavailableReasons).toEqual(["basis_unavailable"]);
    expect(after.players[0]?.axes[0]?.score).toBeTypeOf("number");
    expect(after.players[0]?.axes[0]?.scoreUnavailableReasons).toEqual([]);
    expect(after.players[0]?.axes[1]?.score).toBeNull();
    expect(after.players[0]?.axes[1]?.scoreUnavailableReasons).toEqual(["insufficient_matches"]);
  });
  it("round-trips original precision and accepts small fractions, zero, signs, and exponent notation", () => {
    const input = radarBasisInput(playerRadarBasisDisplay(makePlayerRadarBasis(), []));
    expect(parseRadarThresholdDrafts(radarThresholdDrafts(input)).input).toEqual({
      ...input,
      achievementCurve: input.achievementCurve ?? defaultAchievementCurve,
    });
    const drafts = radarThresholdDrafts(validInput());
    const parsed = parseRadarThresholdDrafts({
      ...drafts,
      revenueP90: ["-4e1", "-30", "-20", "-10", "0", "0.0000000000001", "20", "30", "40"],
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.input?.axes[1]?.thresholds[5]).toBe(1e-13);
    expect(parsed.input?.axes[0]?.thresholds[4]).toBe(2.75);
  });

  it.each(["", "-", ".", "1e", "1,000", "NaN", "Infinity", "1e999", "2.75位"])(
    "rejects the entire invalid input %s instead of falling back or stripping characters",
    (text) => {
      const drafts = radarThresholdDrafts(validInput());
      const result = parseRadarThresholdDrafts({
        ...drafts,
        revenueP90: [text, ...drafts.revenueP90.slice(1)],
      });
      expect(result.input).toBeNull();
      expect(result.errors).toEqual([
        expect.objectContaining({ axisId: "revenueP90", index: 0, kind: "numeric" }),
      ]);
    },
  );

  it("checks strictly ordered boundaries and the best rank without limiting old thresholds to four", () => {
    const drafts = radarThresholdDrafts(validInput());
    expect(parseRadarThresholdDrafts(drafts).errors).toEqual([]);
    expect(
      parseRadarThresholdDrafts({
        ...drafts,
        averageRank: ["5", "4", "3.5", "3", "3", "2.5", "2", "1.5", "0.9"],
      }).errors,
    ).toEqual([
      expect.objectContaining({ axisId: "averageRank", index: 3, kind: "order" }),
      expect.objectContaining({ axisId: "averageRank", index: 4, kind: "order" }),
      expect.objectContaining({ axisId: "averageRank", index: 8, kind: "range" }),
    ]);
  });

  it("points both rank fields to the adjacent score, unrounded value, and strict descending constraint", () => {
    const drafts = radarThresholdDrafts(validInput());
    const result = parseRadarThresholdDrafts({
      ...drafts,
      averageRank: ["3.9999999999999996", ...drafts.averageRank.slice(1)],
    });
    expect(result.input).toBeNull();
    expect(result.errors).toEqual([
      {
        axisId: "averageRank",
        index: 0,
        kind: "order",
        message: "3点の境界（4位）より大きい値にしてください。",
      },
      {
        axisId: "averageRank",
        index: 1,
        kind: "order",
        message: "2点の境界（3.9999999999999996位）より小さい値にしてください。",
      },
    ]);
  });

  it.each(["-30", "-25.5"])(
    "marks both money fields for equality or crossing (%s) with the strict ascending constraint",
    (text) => {
      const drafts = radarThresholdDrafts(validInput());
      const result = parseRadarThresholdDrafts({
        ...drafts,
        revenueP90: [text, ...drafts.revenueP90.slice(1)],
      });
      expect(result.input).toBeNull();
      expect(result.errors).toEqual([
        {
          axisId: "revenueP90",
          index: 0,
          kind: "order",
          message: "3点の境界（-30万円）より小さい値にしてください。",
        },
        {
          axisId: "revenueP90",
          index: 1,
          kind: "order",
          message: `2点の境界（${text}万円）より大きい値にしてください。`,
        },
      ]);
    },
  );

  it("compares values, not formatting or preview scores", () => {
    const input = validInput();
    const drafts = radarThresholdDrafts(input);
    const parsed = parseRadarThresholdDrafts({
      ...drafts,
      revenueP90: ["-40.00", ...drafts.revenueP90.slice(1)],
    });
    expect(sameRadarThresholds(input, parsed.input!)).toBe(true);
  });

  it("scores equality in the good direction and preserves server-owned missing reasons and reference quality", () => {
    const basis = playerRadarBasisDisplay(makePlayerRadarBasis(), []);
    const raw = makePlayerRadarEvaluation();
    raw.players[0]!.axes[0]!.rawValue = 2.75;
    raw.players[0]!.axes[1]!.rawValue = 0;
    raw.players[0]!.axes[2]!.scoreUnavailableReasons = ["insufficient_matches"];
    raw.players[0]!.axes[2]!.score = null;
    raw.players[0]!.axes[1]!.sampleQuality = "reference";
    const before = playerRadarEvaluationDisplay(raw, basis, []);
    const after = previewRadarThresholds(before, basis, validInput());
    expect(after.players[0]!.axes[0]!.score).toBe(6);
    expect(after.players[0]!.axes[1]!.score).toBe(6);
    expect(after.players[0]!.axes[1]!.sampleQuality).toBe("reference");
    expect(after.players[0]!.axes[2]!.score).toBeNull();
    expect(after.players[0]!.axes[2]!.scoreUnavailableReasons).toEqual(["insufficient_matches"]);
    expect(before.players[0]!.axes[0]!.rawValue).toBe(2.75);
  });
});
