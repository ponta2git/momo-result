// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildMatchFeatureBadges,
  seriesComparisonHrefForMatch,
  sortMatchDetailPlayers,
} from "@/features/matches/matchDetailViewModel";
import type { SeriesAnalysisMatchContextV2 } from "@/shared/api/seriesAnalysis";
import { makeFourPlayerResults, makeMatchDetail } from "@/test/factories";

type AnalysisFeature = NonNullable<SeriesAnalysisMatchContextV2["match"]>["features"][number];

function feature(
  featureCode: AnalysisFeature["featureCode"],
  tone: AnalysisFeature["tone"] = "neutral",
): AnalysisFeature {
  return { evidence: [], featureCode, memberIds: [], priority: 1, source: "match", tone };
}

describe("match detail navigation", () => {
  it("opens the matching series scope and keeps the current match as context", () => {
    expect(seriesComparisonHrefForMatch(makeMatchDetail())).toBe(
      "/analytics/series?gameTitleId=gt_momotetsu_2&seasonMasterId=season_current&mapMasterId=map_east&focusMatchId=match-1&view=flow",
    );
  });
});

describe("match detail result ordering", () => {
  it("uses canonical fixed-member order for the initial member sort", () => {
    const players = makeFourPlayerResults().toReversed();

    expect(
      sortMatchDetailPlayers(players, { direction: "asc", key: "member" }).map(
        (player) => player.memberId,
      ),
    ).toEqual(["member_eu", "member_ponta", "member_akane_mami", "member_otaka"]);
  });
});

describe("match detail feature badges", () => {
  it("maps every worker-selected feature in artifact order without reprioritizing", () => {
    const badges = buildMatchFeatureBadges({
      features: [
        feature("asset_blowout", "notice"),
        feature("close_finish"),
        feature("ginji_storm", "notice"),
        feature("negative_assets", "notice"),
        feature("no_destination"),
        feature("revenue_top_no_win"),
      ],
    });

    expect(badges.map((badge) => badge.id)).toEqual([
      "asset_blowout",
      "close_finish",
      "ginji_storm",
      "negative_assets",
      "no_destination",
      "revenue_top_no_win",
    ]);
    expect(badges[0]).toMatchObject({ tone: "notice" });
    expect(badges[2]).toMatchObject({ tone: "notice" });
  });

  it("does not derive fallback badges from the mutable match record", () => {
    expect(buildMatchFeatureBadges({ features: undefined })).toEqual([]);
  });
});
