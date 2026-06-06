// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

import {
  extremumTone,
  formatCountRate,
  formatDecimal,
  formatMoney,
  formatPercent,
  formatPlayOrderLabel,
  formatSigned,
  leaderSummary,
  numericExtrema,
  playOrderColor,
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

  it("finds extrema and highlights only meaningful high or low values", () => {
    const response = responseWithRankAverages([
      ["p0", "ポン太", 2.4],
      ["p1", "ルナ", 1.7],
      ["p2", "ナギ", 3.1],
    ]);
    const extrema = numericExtrema(response, (metrics) => metrics.rank.average);

    expect(extrema).toEqual({ max: 3.1, min: 1.7 });
    expect(extremumTone(3.1, extrema, "max")).toBe("high");
    expect(extremumTone(1.7, extrema, "min")).toBe("low");
    expect(extremumTone(2.4, extrema, "max")).toBe("neutral");
    expect(extremumTone(1.7, { max: 1.7, min: 1.7 }, "max")).toBe("neutral");
  });

  it("maps play order labels and colors with a stable fallback", () => {
    expect(formatPlayOrderLabel(2)).toBe("2P");
    expect(formatPlayOrderLabel(null)).toBe("P不明");
    expect(playOrderColor(1)).toBe("#2563eb");
    expect(playOrderColor(9)).toBe("var(--color-text-muted)");
  });
});

function responseWithRankAverages(
  values: Array<[memberId: string, displayName: string, rankAverage: number]>,
): SeriesComparisonResponse {
  return {
    dataQuality: { items: [] },
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
    playerPerformanceProfiles: { entries: [] },
    playOrderBaselines: [],
    players: values.map(([memberId, displayName]) => ({ displayName, memberId })),
    recentFormByPlayer: [],
    schemaVersion: 4,
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
