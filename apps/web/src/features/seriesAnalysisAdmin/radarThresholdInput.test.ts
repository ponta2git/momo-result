import { describe, expect, it } from "vitest";

import {
  parseRadarThresholdDrafts,
  previewRadarThresholds,
  radarBasisInput,
  radarThresholdDrafts,
  sameRadarThresholds,
} from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import type { RadarManualInput } from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import {
  playerRadarBasisDisplay,
  playerRadarEvaluationDisplay,
} from "@/shared/seriesAnalysis/playerRadarDisplay";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { makePlayerRadarBasis, makePlayerRadarEvaluation } from "@/test/msw/playerRadarFixtures";

import manualFixture from "../../../../../docs/schemas/fixtures/series-analysis/radar-manual-scoring-v1.json";

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
  it("matches the Rust shared scoring fixture at equality and adjacent floating-point boundaries", () => {
    const basis = playerRadarBasisDisplay(makePlayerRadarBasis(), []);
    const input = manualFixture.input as RadarManualInput;
    expect(parseRadarThresholdDrafts(radarThresholdDrafts(input)).input).toEqual(input);
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
    expect(parseRadarThresholdDrafts(radarThresholdDrafts(input)).input).toEqual(input);
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
      expect(result.errors[0]).toMatchObject({ axisId: "revenueP90", index: 0 });
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
      expect.objectContaining({ axisId: "averageRank", index: 4 }),
      expect.objectContaining({ axisId: "averageRank", index: 8 }),
    ]);
  });

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
