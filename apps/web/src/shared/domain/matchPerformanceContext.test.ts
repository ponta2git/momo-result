// @vitest-environment node
import { describe, expect, it } from "vitest";

import { matchPerformanceContextFromArtifact } from "@/shared/domain/matchPerformanceContext";
import {
  makeSeriesAnalysisExcludedMatchContext,
  makeSeriesAnalysisMatchContext,
} from "@/test/msw/seriesAnalysisFixtures";

describe("matchPerformanceContextFromArtifact", () => {
  it("maps worker-computed values without recalculating or rounding them", () => {
    const source = makeSeriesAnalysisMatchContext();
    const context = matchPerformanceContextFromArtifact(source);

    expect(context).toEqual({
      matchIndex: 12,
      rows: [
        {
          cumulativeAverageAfter: 1.75,
          cumulativeAverageBefore: 1.82,
          cumulativeAverageDelta: -0.07,
          memberId: "member_ponta",
          rank: 1,
          revenueAssetRate: 0.12,
          revenueManYen: 25_000,
          revenueRank: 1,
          totalAssetsManYen: 210_000,
          trend: "improved",
        },
      ],
    });
  });

  it("maps the worker's first-observation direction to the ledger vocabulary", () => {
    const source = makeSeriesAnalysisMatchContext();
    if (!source.match) throw new Error("fixture must include a match");
    const players = [
      { ...source.match.players[0]!, cumulativeAverageDirection: "first_observation" as const },
    ];

    const context = matchPerformanceContextFromArtifact({
      ...source,
      match: { ...source.match, players },
    });

    expect(context?.rows.map((row) => row.trend)).toEqual(["firstMatch"]);
  });

  it("maps an unavailable revenue rank to the presentation absence value", () => {
    const source = makeSeriesAnalysisMatchContext();
    if (!source.match) throw new Error("fixture must include a match");
    source.match.players[0]!.revenueRank = null;

    expect(matchPerformanceContextFromArtifact(source)?.rows[0]?.revenueRank).toBeUndefined();
  });

  it.each(["match_changed_since_artifact", "not_in_artifact", "not_in_scope"] as const)(
    "returns no stale context for inclusion status %s",
    (status) => {
      expect(
        matchPerformanceContextFromArtifact(makeSeriesAnalysisExcludedMatchContext(status)),
      ).toBeUndefined();
    },
  );
});
