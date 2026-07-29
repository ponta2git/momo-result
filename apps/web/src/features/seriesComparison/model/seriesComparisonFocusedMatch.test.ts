import { describe, expect, it } from "vitest";

import { buildFocusedMatchMetricContext } from "@/features/seriesComparison/model/seriesComparisonFocusedMatch";
import { makeSeriesComparisonResponse } from "@/test/msw/seriesComparisonFixtures";

describe("buildFocusedMatchMetricContext", () => {
  it("maps a focused match to each exact rank, revenue leader, and prior-rank transition", () => {
    const context = buildFocusedMatchMetricContext(makeSeriesComparisonResponse(), "match-12");

    expect(context.matchId).toBe("match-12");
    expect(context.matchIndex).toBe(12);
    expect(context.pointsByMember.get("member_ponta")?.rank).toBe(1);
    expect(context.revenueTopMemberIds).toEqual(new Set(["member_eu"]));
    expect(context.rankTransitionsByMember.get("member_ponta")).toEqual({
      nextRank: 1,
      previousRank: 4,
    });
  });

  it("returns no metric markers when the match is outside the comparison response", () => {
    const context = buildFocusedMatchMetricContext(makeSeriesComparisonResponse(), "outside-scope");

    expect(context.matchId).toBeUndefined();
    expect(context.pointsByMember.size).toBe(0);
    expect(context.rankTransitionsByMember.size).toBe(0);
    expect(context.revenueTopMemberIds.size).toBe(0);
  });
});
