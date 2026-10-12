import { describe, expect, it } from "vitest";

import {
  radarCurveScale,
  radarScoringSteps,
} from "@/features/seriesAnalysisAdmin/radarScoringCurve";

describe("radar scoring curves", () => {
  it("steps downward as rank grows, preserving the inclusive higher score at every boundary", () => {
    const steps = radarScoringSteps("averageRank", [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1]);
    expect(steps.map((step) => step.rawValue)).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
    expect(steps.map((step) => [step.from, step.to, step.inclusiveScore])).toEqual([
      [10, 9, 10],
      [9, 8, 9],
      [8, 7, 8],
      [7, 6, 7],
      [6, 5, 6],
      [5, 4, 5],
      [4, 3, 4],
      [3, 2, 3],
      [2, 1, 2],
    ]);
  });

  it("steps upward through negative money and zero without interpolating scores", () => {
    const steps = radarScoringSteps(
      "totalAssetsP10",
      [-400, -300, -200, -100, 0, 100, 200, 300, 400],
    );
    expect(steps[4]).toEqual({ rawValue: 0, from: 5, to: 6, inclusiveScore: 6 });
    expect(steps[0]).toEqual({ rawValue: -400, from: 1, to: 2, inclusiveScore: 2 });
    expect(steps[8]).toEqual({ rawValue: 400, from: 9, to: 10, inclusiveScore: 10 });
  });

  it("includes outlying players and keeps finite signed extremes in the same proportional scale", () => {
    const scale = radarCurveScale([-Number.MAX_VALUE, -100, 0, 100, Number.MAX_VALUE]);
    expect(scale.position(-Number.MAX_VALUE)).toBeCloseTo(0.04);
    expect(scale.position(0)).toBeCloseTo(0.5);
    expect(scale.position(Number.MAX_VALUE)).toBeCloseTo(0.96);
    expect(scale.ticks.every(Number.isFinite)).toBe(true);
    expect(radarCurveScale([12, 12]).position(12)).toBe(0.5);
  });
});
