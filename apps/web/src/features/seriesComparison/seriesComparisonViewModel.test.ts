// @vitest-environment node
import { describe, expect, it } from "vitest";

import type {
  SeriesComparisonOptionsResponse,
  SeriesComparisonResponse,
} from "@/shared/api/seriesComparison";

import {
  averageRankSpread,
  assetStyleKindLabel,
  assetStyleShapeLabel,
  assetStyleTagLabel,
  buildSeriesComparisonSearchParams,
  ginjiSummary,
  normalizeSeriesComparisonSelection,
  parseSeriesComparisonSearchParams,
  playOrderSignal,
  profileKindLabel,
  seriesComparisonQueryFromState,
  seriesComparisonReviewQueryFromState,
  statusLabel,
  strategyKindLabel,
  timelineFlagLabel,
} from "./seriesComparisonViewModel";

type PlayerMetrics = NonNullable<SeriesComparisonResponse["metricsByPlayer"]>[number]["metrics"];
type PlayOrderSignalInput = NonNullable<Parameters<typeof playOrderSignal>[0]>;

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
    expect(normalizeSeriesComparisonSelection(options, {})).toEqual({
      gameTitleId: "title-2",
      mapMasterId: undefined,
      seasonMasterId: undefined,
      view: "review",
    });
  });

  it("keeps valid season and map filters and builds an aggregate query", () => {
    const state = normalizeSeriesComparisonSelection(options, {
      gameTitleId: "title-1",
      mapMasterId: "map-1",
      seasonMasterId: "season-1",
    });

    expect(seriesComparisonQueryFromState(state)).toEqual({
      gameTitleId: "title-1",
      mapMasterId: "map-1",
      seasonMasterId: "season-1",
    });
    expect(buildSeriesComparisonSearchParams(state).toString()).toBe(
      "gameTitleId=title-1&seasonMasterId=season-1&mapMasterId=map-1",
    );
  });

  it("keeps the selected analysis view in the URL without adding it to the aggregate query", () => {
    const state = normalizeSeriesComparisonSelection(options, {
      gameTitleId: "title-1",
      view: "drivers",
    });

    expect(seriesComparisonQueryFromState(state)).toEqual({
      gameTitleId: "title-1",
      mapMasterId: undefined,
      seasonMasterId: undefined,
    });
    expect(buildSeriesComparisonSearchParams(state).toString()).toBe(
      "gameTitleId=title-1&view=drivers",
    );
  });

  it("drops obsolete review held event query state", () => {
    const state = normalizeSeriesComparisonSelection(
      options,
      parseSeriesComparisonSearchParams(
        new URLSearchParams("gameTitleId=title-1&reviewHeldEventId=held-event-1"),
      ),
    );

    expect(seriesComparisonQueryFromState(state)).toEqual({
      gameTitleId: "title-1",
      mapMasterId: undefined,
      seasonMasterId: undefined,
    });
    expect(seriesComparisonReviewQueryFromState(state)).toEqual({
      gameTitleId: "title-1",
      mapMasterId: undefined,
      seasonMasterId: undefined,
    });
    expect(buildSeriesComparisonSearchParams(state).toString()).toBe("gameTitleId=title-1");
  });

  it("normalizes invalid filters to the overall scope without selecting a sibling option", () => {
    expect(
      normalizeSeriesComparisonSelection(options, {
        gameTitleId: "title-2",
        mapMasterId: "map-missing",
        seasonMasterId: "season-missing",
      }),
    ).toEqual({
      gameTitleId: "title-2",
      mapMasterId: undefined,
      seasonMasterId: undefined,
      view: "review",
    });
  });

  it("falls back to overall when a filtered deep link has no selectable scopes", () => {
    const noSeasonOptions: SeriesComparisonOptionsResponse = {
      ...options,
      latestConfirmedGameTitleId: "title-1",
      series: [
        {
          ...options.series![0]!,
          maps: [],
          seasons: [],
        },
      ],
    };

    expect(
      normalizeSeriesComparisonSelection(noSeasonOptions, {
        gameTitleId: "title-1",
        mapMasterId: "map-missing",
        seasonMasterId: "season-missing",
      }),
    ).toEqual({
      gameTitleId: "title-1",
      mapMasterId: undefined,
      seasonMasterId: undefined,
      view: "review",
    });
  });

  it("parses legacy scoped links and rewrites them to the new query shape", () => {
    const params = new URLSearchParams("gameTitleId=title-1&scopeKind=map&scopeId=map-1");

    const state = normalizeSeriesComparisonSelection(
      options,
      parseSeriesComparisonSearchParams(params),
    );

    expect(state).toEqual({
      gameTitleId: "title-1",
      mapMasterId: "map-1",
      seasonMasterId: undefined,
      view: "review",
    });
    expect(buildSeriesComparisonSearchParams(state).toString()).toBe(
      "gameTitleId=title-1&mapMasterId=map-1",
    );
  });

  it("parses unknown legacy scope kind as overall and removes scope id", () => {
    const params = new URLSearchParams(
      "gameTitleId=title-1&scopeKind=bad&scopeId=season-1&view=bad",
    );

    expect(parseSeriesComparisonSearchParams(params)).toEqual({
      gameTitleId: "title-1",
      mapMasterId: undefined,
      seasonMasterId: undefined,
      view: "review",
    });
  });

  it.each([
    {
      expected: { label: "比較材料不足", spread: undefined, tone: "flat" },
      values: [1.2],
    },
    {
      expected: { label: "横一線", spread: 0.10000000000000009, tone: "flat" },
      values: [1.2, 1.3],
    },
    {
      expected: { label: "横一線", spread: 0.19999999999999996, tone: "flat" },
      values: [1.2, 1.4],
    },
    {
      expected: { label: "小差", spread: 0.30000000000000004, tone: "small" },
      values: [1.2, 1.5],
    },
    {
      expected: { label: "中差", spread: 0.40000000000000013, tone: "visible" },
      values: [1.2, 1.6],
    },
    {
      expected: { label: "はっきり差", spread: 1.2, tone: "large" },
      values: [1.2, 1.5, 2.1, 2.4],
    },
  ])("classifies average rank spread for $values", ({ expected, values }) => {
    expect(averageRankSpread(responseWithRankAverages(values))).toEqual(expected);
  });

  it("uses the unrounded average rank spread for the 0.35 visible-difference boundary", () => {
    const summary = averageRankSpread(responseWithRankAverages([2.3629, 2.7129]));

    expect(summary).toMatchObject({
      label: "中差",
      tone: "visible",
    });
    expect(summary.spread).toBeCloseTo(0.35);
  });

  it("uses tighter spread bands when the selected scope has enough matches", () => {
    const summary = averageRankSpread(
      responseWithRankAverages([2.367188, 2.445313, 2.554688, 2.632813], 128),
    );

    expect(summary).toMatchObject({
      label: "中差",
      tone: "visible",
    });
    expect(summary.spread).toBeCloseTo(0.265625);
  });

  it("ignores null rank averages from optional API fields", () => {
    const response = responseWithRankAverages([1.2, 1.5]);
    const rank = response.metricsByPlayer?.[1]?.metrics.rank as { average: number | null };
    rank.average = null;

    expect(averageRankSpread(response)).toMatchObject({
      label: "比較材料不足",
      spread: undefined,
      tone: "flat",
    });
  });

  it("ignores non-finite rank averages from defensive display helpers", () => {
    const response = responseWithRankAverages([1.2, Number.NaN]);

    expect(averageRankSpread(response)).toMatchObject({
      label: "比較材料不足",
      spread: undefined,
      tone: "flat",
    });
  });

  it("summarizes ginji counts and abnormal multi-hit matches", () => {
    expect(ginjiSummary(responseWithGinji([0, 1, 2, 3]))).toEqual({
      abnormalMatches: 2,
      totalEncounters: 6,
      warningPlayerIds: ["p2", "p3"],
    });
  });

  it("summarizes play-order signal into best, worst, and spread", () => {
    const metrics = baseMetrics({
      playOrderBreakdown: [
        { matchCount: 3, playOrder: 1, rankAverage: 2.5 },
        { matchCount: 3, playOrder: 2, rankAverage: 1.8 },
        { matchCount: 3, playOrder: 3, rankAverage: 3.1 },
      ],
    });

    const signal = playOrderSignal(metrics);
    expect(signal).toMatchObject({
      best: { playOrder: 2 },
      worst: { playOrder: 3 },
    });
    expect(signal.spread).toBeCloseTo(1.3);
  });

  it("ignores null and non-finite play-order averages", () => {
    const metrics: PlayOrderSignalInput = {
      ...baseMetrics(),
      playOrder: {
        breakdown: [
          { matchCount: 3, playOrder: 1, rankAverage: Number.NaN },
          { matchCount: 3, playOrder: 2, rankAverage: 1.8 },
          { matchCount: 3, playOrder: 3, rankAverage: null },
          { matchCount: 3, playOrder: 4, rankAverage: 2.7 },
        ],
      },
    };

    const signal = playOrderSignal(metrics);
    expect(signal).toMatchObject({
      best: { playOrder: 2 },
      worst: { playOrder: 4 },
    });
    expect(signal.spread).toBeCloseTo(0.9);
  });

  it("formats profile kinds, timeline flags, and reference statuses", () => {
    expect(profileKindLabel("steady_leader")).toBe("安定上位");
    expect(profileKindLabel("swing_chaser")).toBe("波あり追走");
    expect(strategyKindLabel("property_focused")).toBe("桃鉄型（物件重視）");
    expect(strategyKindLabel("card_focused")).toBe("遊戯王型（カード重視）");
    expect(assetStyleKindLabel("asset_explosion")).toBe("資産爆発型");
    expect(assetStyleKindLabel("close_collector")).toBe("接戦回収型");
    expect(assetStyleShapeLabel("upper_side")).toBe("低資産が少なく、高資産寄り");
    expect(assetStyleTagLabel("mobility_collecting")).toBe("目的地寄り");
    expect(timelineFlagLabel("revenue_top_no_win")).toBe("物件収益ねじれ");
    expect(statusLabel("reference")).toBe("参考");
    expect(statusLabel("ok")).toBeUndefined();
  });
});

function responseWithRankAverages(
  values: number[],
  matchCount = values.length,
): SeriesComparisonResponse {
  return {
    dataQuality: { items: [] },
    assetStyleProfiles: {
      entries: [],
    },
    cardShopDestination: { entries: [] },
    highlights: [],
    histograms: { assets: { bins: [], series: [] }, revenue: { bins: [], series: [] } },
    headToHead: { entries: [] },
    matchCount,
    matchNoInEventBreakdown: [],
    matchPlayerPoints: [],
    matchTimeline: [],
    metricsByPlayer: values.map((value, index) => ({
      memberId: `p${index}`,
      metrics: baseMetrics({ rankAverage: value }),
    })),
    momentumSwitch: { entries: [] },
    playerPerformanceProfiles: { entries: [] },
    playOrderBaselines: [],
    players: values.map((_, index) => ({ displayName: `P${index}`, memberId: `p${index}` })),
    recentFormByPlayer: [],
    schemaVersion: 8,
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
  playOrderBreakdown = [],
  rankAverage = 1,
}: {
  ginjiCount?: number;
  multiEncounterMatchCount?: number;
  playOrderBreakdown?: NonNullable<
    SeriesComparisonResponse["metricsByPlayer"]
  >[number]["metrics"]["playOrder"]["breakdown"];
  rankAverage?: number;
} = {}): PlayerMetrics {
  return {
    assets: {},
    denominator: 1,
    destination: { lowerTargetCount: 0, upperTargetCount: 0 },
    destinationOutcome: {
      lowDestination: emptyOutcome(),
      top: emptyOutcome(),
      zeroDestination: emptyOutcome(),
    },
    ginji: {
      count: ginjiCount,
      encounterMatches: ginjiCount > 0 ? 1 : 0,
      maxInSingleMatch: ginjiCount,
      multiEncounterMatchCount,
    },
    lowerHalf: { count: 0 },
    nonRevenue: { highRevenueNoWinCount: 0, highRevenueTopCount: 0 },
    playOrder: { breakdown: playOrderBreakdown },
    podium: { count: 1 },
    rank: { average: rankAverage, distribution: [] },
    revenue: {},
    revenueOutcome: {
      lowRevenue: emptyOutcome(),
      nonTopWinCount: 0,
      top: emptyOutcome(),
    },
    stability: {},
  };
}

function emptyOutcome() {
  return {
    lowerHalfCount: 0,
    rankDistribution: [],
    podiumCount: 0,
    status: "no_target",
    targetCount: 0,
    winCount: 0,
  };
}
