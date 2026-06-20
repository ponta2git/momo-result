// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

import {
  assetStyleEvidence,
  cardShopDestinationDefinitions,
  cardShopQuadrantsByKind,
  extremumEmphasis,
  formatCountRate,
  formatDecimal,
  formatMoney,
  formatPercent,
  formatPlayOrderLabel,
  formatSigned,
  formatSignedPercentPoint,
  leaderSummary,
  momentumSwitchEmphasis,
  momentumSwitchMap,
  numericExtrema,
  playOrderColor,
  playOrderHeatmapRows,
  rankDistributionBars,
  rankOutcomeColor,
  recentRankStrips,
  revenueRankConversionEntries,
} from "./seriesComparisonPresentation";

type PlayerMetrics = NonNullable<SeriesComparisonResponse["metricsByPlayer"]>[number]["metrics"];

describe("seriesComparisonPresentation", () => {
  it("formats nullable display numbers defensively", () => {
    expect(formatDecimal(1.234)).toBe("1.23");
    expect(formatDecimal(Number.NaN)).toBe("-");
    expect(formatPercent(0.456)).toBe("45.6%");
    expect(formatPercent(null)).toBe("-");
    expect(formatCountRate({ count: 2, rate: 0.4, targetCount: 5 })).toBe("2/5戦・40.0%");
    expect(formatCountRate({ count: 0, rate: undefined, targetCount: 0 })).toBe("対象なし");
    expect(formatSigned(1.2)).toBe("+1.20");
    expect(formatSigned(-1.2, "pt")).toBe("-1.20pt");
    expect(formatSignedPercentPoint(0.084)).toBe("+8.4pt");
    expect(formatSignedPercentPoint(-0.061)).toBe("-6.1pt");
    expect(formatMoney(12_345.6)).toBe("1億2346万円");
  });

  it("summarizes the rank leader and ignores non-finite averages", () => {
    const response = responseWithRankAverages([
      ["p0", "ポン太", 2.4],
      ["p1", "ルナ", Number.NaN],
      ["p2", "ナギ", 1.7],
      ["p3", "ミオ", 2.1],
    ]);

    expect(leaderSummary(response)).toEqual({
      averageRank: 1.7,
      gapToSecond: 0.40000000000000013,
      name: "ナギ",
    });
  });

  it("returns an empty leader summary when all averages are missing", () => {
    expect(leaderSummary(responseWithRankAverages([["p0", "ポン太", Number.NaN]]))).toEqual({
      averageRank: undefined,
      gapToSecond: undefined,
      name: undefined,
    });
  });

  it("finds extrema and returns emphasis only for meaningful target values", () => {
    const response = responseWithRankAverages([
      ["p0", "ポン太", 2.4],
      ["p1", "ルナ", 1.7],
      ["p2", "ナギ", 3.1],
    ]);
    const extrema = numericExtrema(response, (metrics) => metrics.rank.average);
    const emphasis = { kind: "leader" as const, label: "4人内最高" };

    expect(extrema).toEqual({ max: 3.1, min: 1.7 });
    expect(extremumEmphasis(3.1, extrema, "max", emphasis)).toEqual(emphasis);
    expect(extremumEmphasis(1.7, extrema, "min", emphasis)).toEqual(emphasis);
    expect(extremumEmphasis(2.4, extrema, "max", emphasis)).toBeUndefined();
    expect(extremumEmphasis(1.7, { max: 1.7, min: 1.7 }, "max", emphasis)).toBeUndefined();
  });

  it("maps play order labels and colors with a stable fallback", () => {
    expect(formatPlayOrderLabel(2)).toBe("2P");
    expect(formatPlayOrderLabel(null)).toBe("P不明");
    expect(playOrderColor(1)).toBe("var(--color-player-1)");
    expect(playOrderColor(9)).toBe("var(--color-text-muted)");
  });

  it("derives rank strips from all timeline points while keeping recent metadata", () => {
    const response = responseWithRankAverages([["p0", "ポン太", 2.4]]);
    response.recentFormByPlayer = [
      {
        averageRank: 2,
        lowerHalfStreak: 0,
        memberId: "p0",
        podiumRate: 0.5,
        podiumStreak: 1,
        status: "normal",
        targetCount: 3,
        windowSize: 3,
        winStreak: 0,
      },
    ];
    response.matchPlayerPoints = [
      matchPoint({ matchIndex: 1, rank: 4 }),
      matchPoint({ matchIndex: 3, rank: 1 }),
      matchPoint({ matchIndex: 2, rank: 2 }),
      matchPoint({ matchIndex: 4, rank: 3 }),
    ];

    expect(recentRankStrips(response)).toEqual([
      {
        memberId: "p0",
        points: [
          { matchId: "match-1", matchIndex: 1, rank: 4 },
          { matchId: "match-2", matchIndex: 2, rank: 2 },
          { matchId: "match-3", matchIndex: 3, rank: 1 },
          { matchId: "match-4", matchIndex: 4, rank: 3 },
        ],
        status: "normal",
        targetCount: 3,
        totalCount: 4,
        windowSize: 3,
      },
    ]);
  });

  it("derives rank distribution bars in rank order", () => {
    const response = responseWithRankAverages([["p0", "ポン太", 2.4]]);
    const metrics = response.metricsByPlayer?.[0]?.metrics;
    if (!metrics) throw new Error("metrics missing");
    metrics.rank.distribution = [
      { count: 1, rank: 2, rate: 0.25 },
      { count: 3, rank: 1, rate: 0.75 },
    ];

    expect(rankDistributionBars(response)).toEqual([
      {
        memberId: "p0",
        segments: [
          { count: 3, rank: 1, rate: 0.75 },
          { count: 1, rank: 2, rate: 0.25 },
        ],
        totalCount: 4,
      },
    ]);
  });

  it("derives play-order heatmap cells with empty play orders preserved", () => {
    const response = responseWithRankAverages([["p0", "ポン太", 2.4]]);
    const metrics = response.metricsByPlayer?.[0]?.metrics;
    if (!metrics) throw new Error("metrics missing");
    metrics.playOrder.breakdown = [
      { matchCount: 2, playOrder: 2, rankAverage: 1.5 },
      { matchCount: 3, playOrder: 4, rankAverage: 3 },
    ];

    expect(playOrderHeatmapRows(response)).toEqual([
      {
        memberId: "p0",
        cells: [
          { matchCount: 0, playOrder: 1, rankAverage: undefined },
          { matchCount: 2, playOrder: 2, rankAverage: 1.5 },
          { matchCount: 0, playOrder: 3, rankAverage: undefined },
          { matchCount: 3, playOrder: 4, rankAverage: 3 },
        ],
      },
    ]);
  });

  it("keeps rank outcome colors and card-shop quadrant order stable", () => {
    expect(rankOutcomeColor(1)).toBe("var(--color-rank-1)");
    expect(rankOutcomeColor(4)).toBe("var(--color-rank-4)");
    expect(cardShopDestinationDefinitions.map((item) => item.kind)).toEqual([
      "destination_with_shop",
      "destination_without_shop",
      "no_destination_with_shop",
      "no_destination_without_shop",
    ]);

    const entry = {
      cardShopMatchCount: 5,
      cardShopWithoutDestinationCount: 2,
      denominator: 8,
      memberId: "p0",
      quadrants: [
        {
          averageRank: 1.5,
          kind: "destination_with_shop",
          status: "ok",
          targetCount: 3,
        },
        {
          averageRank: 2.5,
          kind: "no_destination_with_shop",
          status: "reference",
          targetCount: 2,
        },
      ],
    } satisfies NonNullable<SeriesComparisonResponse["cardShopDestination"]["entries"]>[number];

    const byKind = cardShopQuadrantsByKind(entry);
    expect(byKind.get("destination_with_shop")?.targetCount).toBe(3);
    expect(byKind.get("no_destination_with_shop")?.averageRank).toBe(2.5);
  });

  it("derives asset-style evidence by profile kind", () => {
    const profile = {
      memberId: "p0",
      metrics: {
        blowoutWinCount: 2,
        heavyLossCount: 1,
        highAssetCount: 4,
        highAssetRate: 0.4,
        lowAssetCount: 3,
        lowAssetRate: 0.3,
        lowerHalfMedianGap: 3200,
        nearMissSecondCount: 1,
        secondCount: 1,
        winCount: 4,
      },
      primaryKind: "high_risk_breakthrough",
      status: "ok",
      targetCount: 10,
    } satisfies NonNullable<SeriesComparisonResponse["assetStyleProfiles"]["entries"]>[number];

    expect(
      assetStyleEvidence(profile, {
        blowoutWinThreshold: 2400,
        entries: [],
        highAssetThreshold: 9000,
        lowAssetThreshold: 500,
      }).map((item) => ({
        emphasis: item.emphasis?.kind,
        key: item.key,
        label: item.label,
        value: item.value,
      })),
    ).toEqual([
      {
        emphasis: "strength",
        key: "high-assets",
        label: "高資産帯",
        value: "4/10戦・40.0%",
      },
      {
        emphasis: "risk",
        key: "low-assets-risk",
        label: "低資産帯",
        value: "3/10戦・30.0%",
      },
      {
        emphasis: "risk",
        key: "lower-gap",
        label: "下位時の差",
        value: "3200万円",
      },
    ]);
  });

  it("maps momentum switch entries and emphasizes only ok threshold deltas", () => {
    const response = responseWithRankAverages([["p0", "ポン太", 2.4]]);
    response.momentumSwitch = {
      entries: [
        {
          afterFourth: {
            baselineRate: 0.55,
            deltaFromBaseline: -0.12,
            rate: 0.43,
            status: "ok",
            successCount: 3,
            targetCount: 8,
          },
          afterLower: {
            baselineRate: 0.55,
            deltaFromBaseline: 0.061,
            rate: 0.611,
            status: "ok",
            successCount: 5,
            targetCount: 8,
          },
          afterPodium: {
            baselineRate: 0.45,
            deltaFromBaseline: -0.061,
            rate: 0.389,
            status: "ok",
            successCount: 3,
            targetCount: 8,
          },
          denominator: 9,
          memberId: "p0",
          transitionCount: 8,
          transitionRows: [],
        },
      ],
    };

    expect(momentumSwitchMap(response).get("p0")?.transitionCount).toBe(8);
    expect(momentumSwitchEmphasis("afterLower", 0.061, "ok")).toEqual({
      kind: "strength",
      label: "強み",
    });
    expect(momentumSwitchEmphasis("afterFourth", -0.12, "ok")).toEqual({
      kind: "risk",
      label: "注意",
    });
    expect(momentumSwitchEmphasis("afterPodium", -0.061, "ok")).toEqual({
      kind: "strength",
      label: "強み",
    });
    expect(momentumSwitchEmphasis("afterLower", 0.2, "reference")).toBeUndefined();
  });

  it("derives revenue-rank conversion rows and keeps tied revenue ranks", () => {
    const response = responseWithRankAverages([["p0", "ポン太", 2.4]]);
    response.matchPlayerPoints = [
      matchPoint({ matchIndex: 1, rank: 1, revenueRank: 1 }),
      matchPoint({ matchIndex: 2, rank: 2, revenueRank: 1 }),
      matchPoint({ matchIndex: 3, rank: 4, revenueRank: 2.5 }),
      matchPoint({ matchIndex: 4, rank: 2, revenueRank: 2.5 }),
    ];

    expect(revenueRankConversionEntries(response)).toEqual([
      {
        memberId: "p0",
        rows: [
          {
            finalRankCounts: [
              { count: 1, rank: 1, rate: 0.5 },
              { count: 1, rank: 2, rate: 0.5 },
              { count: 0, rank: 3, rate: 0 },
              { count: 0, rank: 4, rate: 0 },
            ],
            revenueRank: 1,
            targetCount: 2,
          },
          {
            finalRankCounts: [
              { count: 0, rank: 1, rate: 0 },
              { count: 1, rank: 2, rate: 0.5 },
              { count: 0, rank: 3, rate: 0 },
              { count: 1, rank: 4, rate: 0.5 },
            ],
            revenueRank: 2.5,
            targetCount: 2,
          },
        ],
      },
    ]);
  });
});

function responseWithRankAverages(
  values: Array<[memberId: string, displayName: string, rankAverage: number]>,
): SeriesComparisonResponse {
  return {
    dataQuality: { items: [] },
    assetStyleProfiles: { entries: [] },
    cardShopDestination: { entries: [] },
    highlights: [],
    histograms: { assets: { bins: [], series: [] }, revenue: { bins: [], series: [] } },
    headToHead: { entries: [] },
    matchCount: values.length,
    matchNoInEventBreakdown: [],
    matchPlayerPoints: [],
    matchTimeline: [],
    metricsByPlayer: values.map(([memberId, , rankAverage]) => ({
      memberId,
      metrics: baseMetrics(rankAverage),
    })),
    momentumSwitch: { entries: [] },
    playerPerformanceProfiles: { entries: [] },
    playOrderBaselines: [],
    players: values.map(([memberId, displayName]) => ({ displayName, memberId })),
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

function baseMetrics(rankAverage: number): PlayerMetrics {
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
      count: 0,
      encounterMatches: 0,
      maxInSingleMatch: 0,
      multiEncounterMatchCount: 0,
    },
    lowerHalf: { count: 0 },
    nonRevenue: { highRevenueNoWinCount: 0, highRevenueTopCount: 0 },
    playOrder: { breakdown: [] },
    podium: { count: 0 },
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

function matchPoint({
  matchIndex,
  rank,
  revenueRank = rank,
}: {
  matchIndex: number;
  rank: number;
  revenueRank?: number;
}): NonNullable<SeriesComparisonResponse["matchPlayerPoints"]>[number] {
  return {
    assetsRank: rank,
    matchId: `match-${matchIndex}`,
    matchIndex,
    memberId: "p0",
    playedAt: "2026-01-01T00:00:00Z",
    rank,
    revenue: 1000,
    revenueAssetRate: 0.2,
    revenueRank,
    totalAssets: 5000,
  };
}
