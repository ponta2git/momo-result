import { describe, expect, it } from "vitest";

import {
  needLinePoints,
  needLineScale,
  needLineThreshold,
} from "@/features/seriesComparison/outlook/workspace/needLine";

// The requirement's worked example: 200 games each, rank sums 510 and 500.
const behind = { games: 200, focusRankSum: 510, rivalRankSum: 500 };
// A leader who keeps a 4-point rank-sum lead after 32 games.
const ahead = { games: 32, focusRankSum: 74, rivalRankSum: 78 };

describe("need line", () => {
  it("draws the reverse calculation for each game count", () => {
    expect(needLineThreshold(behind, 2.55, 50)).toBeCloseTo(2.35);
    expect(needLineThreshold(behind, 2.55, 100)).toBeCloseTo(2.45);
    expect(needLineThreshold(ahead, 2.45, 100)).toBeCloseTo(2.49);
  });

  it("fits the axis around the compared lines inside the rank range", () => {
    const scale = needLineScale([2.85, 2.45, 2.49]);
    expect(scale.min).toBeLessThanOrEqual(2.33);
    expect(scale.max).toBeGreaterThanOrEqual(2.97);
    expect(scale.min).toBeGreaterThanOrEqual(1);
    expect(scale.max).toBeLessThanOrEqual(4);
    expect(scale.ticks[0]).toBe(scale.min);
    expect(needLineScale([1.02, 3.98]).ticks).toEqual(expect.arrayContaining([1, 4]));
  });

  it("covers the whole displayed range", () => {
    const points = needLinePoints(ahead, 2.45, 100);
    expect(points[0]?.[0]).toBe(0.25);
    expect(points.at(-1)?.[0]).toBeCloseTo(100);
  });
});
