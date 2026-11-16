import { describe, expect, it } from "vitest";

import {
  formatAxisTick,
  formatBackgroundValue,
  formatRankGap,
  gapAxis,
  gapDirection,
  gapLayerLabel,
  gapLevelLabel,
} from "@/features/seriesComparison/model/expectedRankGapPresentation";
import { makeExpectedRankGap } from "@/test/msw/seriesAnalysisFixtures";

function layer(destinationLevels: number[]) {
  return { count: 3, destinationLevels, expectedRank: 3, revenueRank: 4 };
}

describe("expected-rank gap presentation", () => {
  it("names levels with the same inclusive wording as the Worker sentences", () => {
    expect(gapLevelLabel({ minimumCount: 0, maximumCount: 0 })).toBe("0回");
    expect(gapLevelLabel({ minimumCount: 1, maximumCount: null })).toBe("1回以上");
    expect(gapLevelLabel({ minimumCount: 0, maximumCount: 3 })).toBe("3回以下");
    expect(gapLevelLabel({ minimumCount: 4, maximumCount: 5 })).toBe("4〜5回");
  });

  it("reads a merged layer as one destination range", () => {
    expect(gapLayerLabel(layer([0]))).toBe("収益4位・目的地0回");
    expect(gapLayerLabel(layer([2]))).toBe("収益4位・目的地2回以上");
    expect(gapLayerLabel(layer([1, 2]))).toBe("収益4位・目的地1回以上");
    expect(gapLayerLabel(layer([0, 1]))).toBe("収益4位・目的地1回以下");
    expect(gapLayerLabel(layer([0, 1, 2]))).toBe("収益4位・目的地の回数を問わない");
  });

  it("signs rank gaps and reads a value that rounds to zero as even", () => {
    expect(formatRankGap(0.0787)).toBe("＋0.08位");
    expect(formatRankGap(-0.1476)).toBe("−0.15位");
    expect(formatRankGap(-0.0001)).toBe("±0.00位");
    expect(formatRankGap(null)).toBe("—");
    expect(formatBackgroundValue("revenue_share", 0.012)).toBe("＋1.2ポイント");
    expect(formatBackgroundValue("card_station", -0.25)).toBe("−0.25回");
    expect(formatRankGap(0.005)).toBe("＋0.01位");
    expect(formatRankGap(-0.005)).toBe("−0.01位");
    expect(gapDirection(-0.005)).toBe("below");
    expect(formatBackgroundValue("revenue_share", -0.0005)).toBe("−0.1ポイント");
    expect(formatBackgroundValue("card_station", -0.005)).toBe("−0.01回");
  });

  it("shares one symmetric axis of five to seven round ticks over every judged value", () => {
    const fixture = makeExpectedRankGap();
    const axis = gapAxis(fixture);
    // The largest judged value is the card-shop 2+ gap of 0.40 (×1.05 → 0.6 at a 0.2 step).
    expect(axis.scale).toBeCloseTo(0.6);
    expect(axis.ticks).toEqual([-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]);
    const wide = structuredClone(fixture);
    const player = wide.players[0];
    if (!player) throw new Error("fixture player is missing");
    player.meanGap = -0.76;
    // 0.8 at a 0.2 step would need nine ticks; a 0.4 step keeps five.
    expect(gapAxis(wide).ticks).toEqual([-0.8, -0.4, 0, 0.4, 0.8]);
    expect(formatAxisTick(-0.6)).toBe("−0.6");
    expect(formatAxisTick(0.2)).toBe("＋0.2");
    expect(formatAxisTick(0)).toBe("0");
  });
});
