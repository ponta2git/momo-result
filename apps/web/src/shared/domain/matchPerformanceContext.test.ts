// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildMatchPerformanceContext } from "@/shared/domain/matchPerformanceContext";
import type { MatchPerformanceInput } from "@/shared/domain/matchPerformanceContext";

const currentResults: MatchPerformanceInput[] = [
  { memberId: "a", rank: 1, revenueManYen: 900, totalAssetsManYen: 1800 },
  { memberId: "b", rank: 2, revenueManYen: 900, totalAssetsManYen: 0 },
  { memberId: "c", rank: 3, revenueManYen: 400, totalAssetsManYen: -100 },
  { memberId: "d", rank: 4, revenueManYen: 100, totalAssetsManYen: 500 },
];

function point(matchId: string, matchIndex: number, memberId: string, rank: number) {
  return {
    assetsRank: rank,
    matchId,
    matchIndex,
    memberId,
    playedAt: "2026-04-04T12:34:56.000Z",
    rank,
    revenue: 100,
    revenueRank: rank,
    totalAssets: 1000,
  };
}

describe("buildMatchPerformanceContext", () => {
  it("calculates local revenue ratios and average ranks for ties", () => {
    const context = buildMatchPerformanceContext({
      currentResults,
      matchId: "target",
    });

    expect(context.rows.map((row) => row.revenueRank)).toEqual([1.5, 1.5, 3, 4]);
    expect(context.rows.map((row) => row.revenueAssetRate)).toEqual([
      0.5,
      undefined,
      undefined,
      0.2,
    ]);
  });

  it("shows how the target match changes each cumulative average rank", () => {
    const context = buildMatchPerformanceContext({
      currentResults,
      matchId: "target",
      matchPlayerPoints: [
        point("before-a", 1, "a", 3),
        point("target", 2, "a", 1),
        point("before-b", 1, "b", 1),
        point("target", 2, "b", 3),
        point("target", 2, "c", 2),
        point("before-d", 1, "d", 2),
        point("target", 2, "d", 2),
      ],
    });

    expect(context.targetIncluded).toBe(true);
    expect(context.matchIndex).toBe(2);
    expect(context.rows.map((row) => row.trend)).toEqual([
      "improved",
      "declined",
      "firstMatch",
      "unchanged",
    ]);
    expect(context.rows[0]).toMatchObject({
      cumulativeAverageAfter: 2,
      cumulativeAverageBefore: 3,
      cumulativeAverageDelta: -1,
    });
    expect(context.rows[1]).toMatchObject({
      cumulativeAverageAfter: 2,
      cumulativeAverageBefore: 1,
      cumulativeAverageDelta: 1,
    });
  });

  it("keeps comparison context unavailable when the selected match is absent", () => {
    const context = buildMatchPerformanceContext({
      currentResults,
      matchId: "missing",
      matchPlayerPoints: [point("other", 1, "a", 1)],
    });

    expect(context.targetIncluded).toBe(false);
    expect(context.rows.every((row) => row.trend === "unavailable")).toBe(true);
  });

  it("treats changes that round to the same displayed value as maintained", () => {
    const context = buildMatchPerformanceContext({
      currentResults: [{ memberId: "a", rank: 2, revenueManYen: 100, totalAssetsManYen: 1000 }],
      matchId: "target",
      matchPlayerPoints: [
        ...Array.from({ length: 249 }, (_, index) => point(`before-${index}`, index + 1, "a", 2)),
        point("target", 250, "a", 1),
      ],
    });

    expect(context.rows[0]?.cumulativeAverageDelta).toBeCloseTo(-0.004);
    expect(context.rows[0]?.trend).toBe("unchanged");
  });
});
