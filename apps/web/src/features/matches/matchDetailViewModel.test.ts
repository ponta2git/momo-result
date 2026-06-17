// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildMatchFeatureBadges } from "@/features/matches/matchDetailViewModel";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { makeFourPlayerResults, makeIncidents, makeMatchDetail } from "@/test/factories";
import { makeSeriesComparisonResponse } from "@/test/msw/seriesComparisonHandlers";

function seriesWithFlags(flags: string[]): SeriesComparisonResponse {
  return {
    ...makeSeriesComparisonResponse(),
    matchTimeline: [
      {
        assetGapFirstToLast: 1000,
        assetGapFirstToSecond: 100,
        flags,
        matchId: "match-1",
        matchIndex: 1,
        playedAt: "2026-04-04T12:34:56.000Z",
        revenueTopMemberIds: ["member_ponta"],
        status: "ok",
        totalGinjiCount: 0,
        winnerMemberId: "member_eu",
      },
    ],
  };
}

describe("match detail feature badges", () => {
  it("merges relative series features and match-record features in display priority", () => {
    const match = makeMatchDetail({
      players: makeFourPlayerResults([
        {
          incidents: makeIncidents(),
          rank: 2,
          revenueManYen: 900,
          totalAssetsManYen: -100,
        },
        {
          incidents: makeIncidents(),
          rank: 3,
          revenueManYen: 800,
          totalAssetsManYen: 500,
        },
        {
          incidents: makeIncidents(),
          rank: 4,
          revenueManYen: 700,
          totalAssetsManYen: 400,
        },
        {
          incidents: makeIncidents({ suriNoGinji: 2 }),
          rank: 1,
          revenueManYen: 100,
          totalAssetsManYen: 1000,
        },
      ]),
    });

    const badges = buildMatchFeatureBadges({
      match,
      maxItems: 10,
      seriesComparison: seriesWithFlags(["asset_blowout", "close_finish", "ginji_storm"]),
    });

    expect(badges.map((badge) => badge.id)).toEqual([
      "close_finish",
      "asset_blowout",
      "revenue_top_no_win",
      "ginji_storm",
      "negative_assets",
      "no_destination",
      "low_revenue_win",
      "fourth_order_win",
    ]);
    expect(badges.find((badge) => badge.id === "close_finish")?.source).toBe("series");
    expect(badges.find((badge) => badge.id === "ginji_storm")?.source).toBe("match");
  });

  it("limits the visible list to six badges by default", () => {
    const match = makeMatchDetail({
      players: makeFourPlayerResults([
        { rank: 2, revenueManYen: 900, totalAssetsManYen: -100 },
        { rank: 3, revenueManYen: 800, totalAssetsManYen: 500 },
        { rank: 4, revenueManYen: 700, totalAssetsManYen: 400 },
        {
          incidents: makeIncidents({ suriNoGinji: 2 }),
          rank: 1,
          revenueManYen: 100,
          totalAssetsManYen: 1000,
        },
      ]),
    });

    const badges = buildMatchFeatureBadges({
      match,
      seriesComparison: seriesWithFlags(["close_finish", "asset_blowout"]),
    });

    expect(badges).toHaveLength(6);
    expect(badges.map((badge) => badge.id)).toEqual([
      "close_finish",
      "asset_blowout",
      "revenue_top_no_win",
      "ginji_storm",
      "negative_assets",
      "no_destination",
    ]);
  });

  it("uses destination burst instead of no-destination when arrivals are frequent", () => {
    const match = makeMatchDetail({
      players: makeFourPlayerResults([
        { incidents: makeIncidents({ destination: 1 }) },
        { incidents: makeIncidents({ destination: 1 }) },
        { incidents: makeIncidents({ destination: 1 }) },
        { incidents: makeIncidents({ destination: 1 }) },
      ]),
    });

    expect(buildMatchFeatureBadges({ match }).map((badge) => badge.id)).toContain(
      "destination_burst",
    );
    expect(buildMatchFeatureBadges({ match }).map((badge) => badge.id)).not.toContain(
      "no_destination",
    );
  });

  it("falls back to match-record features when series comparison is unavailable", () => {
    const match = makeMatchDetail({
      players: makeFourPlayerResults([
        { rank: 1, revenueManYen: 300 },
        { rank: 2, revenueManYen: 400 },
        { rank: 3, revenueManYen: 200 },
        { rank: 4, revenueManYen: 100 },
      ]),
    });

    expect(buildMatchFeatureBadges({ match }).map((badge) => badge.id)).toEqual([
      "revenue_top_no_win",
      "no_destination",
    ]);
  });
});
