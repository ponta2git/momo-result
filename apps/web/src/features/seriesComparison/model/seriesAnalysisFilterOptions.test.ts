import { describe, expect, it } from "vitest";

import { buildSeriesAnalysisFilterOptions } from "@/features/seriesComparison/model/seriesAnalysisFilterOptions";
import { normalizeSeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { makeSeriesAnalysisOptions } from "@/test/msw/seriesAnalysisFixtures";

describe("series analysis empty filter combinations", () => {
  it("retains individually valid season and map identities even when their combination has no matches", () => {
    const options = makeSeriesAnalysisOptions();
    options.titles[0]!.seasonMapPairs = [];
    const state = {
      gameTitleId: "gt_momotetsu_2",
      seasonMasterId: "season_current",
      mapMasterId: "map_east",
    };
    expect(normalizeSeriesAnalysisSelection(options, state)).toMatchObject(state);
    const filters = buildSeriesAnalysisFilterOptions(options, state);
    expect(filters.mapOptions.find((option) => option.value === "map_east")).toEqual({
      value: "map_east",
      label: "東日本編",
    });
    expect(filters.seasonOptions.find((option) => option.value === "season_current")).toEqual({
      value: "season_current",
      label: "今シーズン",
    });
  });

  it("still removes invalid identities instead of treating an unknown map as a valid empty result", () => {
    expect(
      normalizeSeriesAnalysisSelection(makeSeriesAnalysisOptions(), {
        gameTitleId: "gt_momotetsu_2",
        seasonMasterId: "season_current",
        mapMasterId: "different-title-map",
        focusMatchId: "previous-match",
      }),
    ).toEqual({
      gameTitleId: "gt_momotetsu_2",
      seasonMasterId: "season_current",
      ownerMetric: "rank.average",
      view: "review",
    });
  });
});
