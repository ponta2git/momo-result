// @vitest-environment node
import { describe, expect, it } from "vitest";

import type {
  SeriesComparisonOptionsResponse,
  SeriesComparisonResponse,
} from "@/shared/api/seriesComparison";

import {
  averageRankSpread,
  buildSeriesComparisonSearchParams,
  ginjiSummary,
  normalizeSeriesComparisonSelection,
  parseSeriesComparisonSearchParams,
  seriesComparisonQueryFromState,
} from "./seriesComparisonViewModel";

describe("seriesComparisonViewModel", () => {
  const options: SeriesComparisonOptionsResponse = {
    latestConfirmedGameTitleId: "title-2",
    schemaVersion: 1,
    series: [
      {
        confirmedMatchCount: 4,
        gameTitleId: "title-1",
        layoutFamily: "classic",
        maps: [{ confirmedMatchCount: 4, displayOrder: 1, id: "map-1", name: "全国" }],
        name: "桃鉄1",
        seasons: [{ confirmedMatchCount: 4, displayOrder: 1, id: "season-1", name: "春" }],
        displayOrder: 1,
      },
      {
        confirmedMatchCount: 7,
        gameTitleId: "title-2",
        layoutFamily: "momo2",
        maps: [{ confirmedMatchCount: 7, displayOrder: 1, id: "map-2", name: "西日本" }],
        name: "桃鉄2",
        seasons: [{ confirmedMatchCount: 7, displayOrder: 1, id: "season-2", name: "夏" }],
        displayOrder: 2,
      },
    ],
  };

  it("defaults to the latest confirmed series and overall scope", () => {
    expect(normalizeSeriesComparisonSelection(options, { scopeKind: "overall" })).toEqual({
      gameTitleId: "title-2",
      scopeId: undefined,
      scopeKind: "overall",
    });
  });

  it("keeps a valid scoped deep link and builds an aggregate query", () => {
    const state = normalizeSeriesComparisonSelection(options, {
      gameTitleId: "title-1",
      scopeId: "map-1",
      scopeKind: "map",
    });

    expect(seriesComparisonQueryFromState(state)).toEqual({
      gameTitleId: "title-1",
      scopeId: "map-1",
      scopeKind: "map",
    });
    expect(buildSeriesComparisonSearchParams(state).toString()).toBe(
      "gameTitleId=title-1&scopeKind=map&scopeId=map-1",
    );
  });

  it("normalizes missing scoped ids to the first selectable scope", () => {
    expect(
      normalizeSeriesComparisonSelection(options, {
        gameTitleId: "title-2",
        scopeKind: "season",
      }),
    ).toEqual({
      gameTitleId: "title-2",
      scopeId: "season-2",
      scopeKind: "season",
    });
  });

  it("parses unknown scope kind as overall and removes scope id", () => {
    const params = new URLSearchParams("gameTitleId=title-1&scopeKind=bad&scopeId=season-1");

    expect(parseSeriesComparisonSearchParams(params)).toEqual({
      gameTitleId: "title-1",
      scopeId: undefined,
      scopeKind: "overall",
    });
  });

  it("treats an average rank spread of 0.30 as a visible difference", () => {
    const response = responseWithRankAverages([1.2, 1.5, 2.1, 2.4]);

    expect(averageRankSpread(response)).toMatchObject({
      label: "はっきり差",
      spread: 1.2,
      tone: "large",
    });

    const closeResponse = responseWithRankAverages([1.2, 1.5]);
    expect(averageRankSpread(closeResponse)).toMatchObject({
      label: "差が見え始めた",
      spread: 0.30000000000000004,
      tone: "visible",
    });
  });

  it("summarizes ginji counts and abnormal multi-hit matches", () => {
    expect(ginjiSummary(responseWithGinji([0, 1, 2, 3]))).toEqual({
      abnormalMatches: 2,
      totalEncounters: 6,
      warningPlayerIds: ["p2", "p3"],
    });
  });
});

function responseWithRankAverages(values: number[]): SeriesComparisonResponse {
  return {
    dataQuality: { items: [] },
    highlights: [],
    histograms: { assets: { bins: [], series: [] }, revenue: { bins: [], series: [] } },
    matchCount: values.length,
    metricsByPlayer: values.map((value, index) => ({
      memberId: `p${index}`,
      metrics: baseMetrics({ rankAverage: value }),
    })),
    players: values.map((_, index) => ({ displayName: `P${index}`, memberId: `p${index}` })),
    schemaVersion: 1,
    scope: {
      gameTitleId: "title",
      gameTitleName: "桃鉄",
      layoutFamily: "momo",
      scopeKind: "overall",
      scopeName: "総合",
    },
    trends: {},
  };
}

function responseWithGinji(values: number[]): SeriesComparisonResponse {
  const response = responseWithRankAverages(values.map(() => 1));
  return {
    ...response,
    metricsByPlayer: values.map((value, index) => ({
      memberId: `p${index}`,
      metrics: baseMetrics({ ginjiCount: value, multiEncounterMatchCount: value >= 2 ? 1 : 0 }),
    })),
  };
}

function baseMetrics({
  ginjiCount = 0,
  multiEncounterMatchCount = 0,
  rankAverage = 1,
}: {
  ginjiCount?: number;
  multiEncounterMatchCount?: number;
  rankAverage?: number;
}) {
  return {
    assets: {},
    denominator: 1,
    destination: { lowerTargetCount: 0, upperTargetCount: 0 },
    ginji: {
      count: ginjiCount,
      encounterMatches: ginjiCount > 0 ? 1 : 0,
      maxInSingleMatch: ginjiCount,
      multiEncounterMatchCount,
    },
    lowerHalf: { count: 0 },
    nonRevenue: { highRevenueNoWinCount: 0, highRevenueTopCount: 0 },
    playOrder: {},
    podium: { count: 1 },
    rank: { average: rankAverage, distribution: [] },
    revenue: {},
    stability: {},
  };
}
