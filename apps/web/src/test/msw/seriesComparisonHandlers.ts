import { http, HttpResponse } from "msw";

import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

const players = [
  { displayName: "ぽんた", memberId: "member_ponta" },
  { displayName: "あかね", memberId: "member_akane_mami" },
  { displayName: "おたか", memberId: "member_otaka" },
  { displayName: "いーゆー", memberId: "member_eu" },
];

export const seriesComparisonHandlers = [
  http.get("/api/analytics/series-comparison/options", () =>
    HttpResponse.json({
      latestConfirmedGameTitleId: "gt_momotetsu_2",
      schemaVersion: 1,
      series: [
        {
          confirmedMatchCount: 12,
          displayOrder: 1,
          gameTitleId: "gt_momotetsu_2",
          latestConfirmedPlayedAt: "2026-05-10T12:00:00.000Z",
          layoutFamily: "momotetsu_2",
          maps: [{ confirmedMatchCount: 12, displayOrder: 1, id: "map_east", name: "東日本編" }],
          name: "桃太郎電鉄2",
          seasons: [
            { confirmedMatchCount: 12, displayOrder: 1, id: "season_current", name: "今シーズン" },
          ],
        },
      ],
    }),
  ),
  http.get("/api/analytics/series-comparison", () =>
    HttpResponse.json(makeSeriesComparisonResponse()),
  ),
];

function makeSeriesComparisonResponse(): SeriesComparisonResponse {
  const averages = [1.2, 1.5, 2.4, 3.1];
  return {
    dataQuality: {
      items: [
        {
          denominator: 12,
          hasTies: false,
          metricId: "ginji.resilienceRankAverage",
          playerMemberId: "member_ponta",
          status: "reference",
          targetCount: 2,
        },
      ],
    },
    highlights: [
      {
        id: "highlight.assetsPeak",
        metricId: "assets.max",
        status: "ok",
        targetCount: 12,
        title: "資産ピーク王",
        value: 9000,
        winnerMemberIds: ["member_ponta"],
      },
    ],
    histograms: {
      assets: histogram(),
      revenue: histogram(),
    },
    matchCount: 12,
    metricsByPlayer: players.map((player, index) => ({
      memberId: player.memberId,
      metrics: {
        assets: { average: 2600 - index * 220, max: 9000 - index * 500, median: 2400, min: 500 },
        denominator: 12,
        destination: {
          conversionDelta: index === 0 ? 0.55 : -0.2,
          dependenceScore: index === 1 ? 1.1 : 0.2,
          lowerTargetCount: 5,
          upperTargetCount: 7,
        },
        ginji: {
          count: index === 3 ? 3 : index,
          encounterMatches: index === 3 ? 2 : index,
          encounterRate: index === 3 ? 0.16 : index / 12,
          maxInSingleMatch: index === 3 ? 2 : 1,
          multiEncounterMatchCount: index === 3 ? 1 : 0,
          resilienceAssetsAverage: 1800,
          resilienceRankAverage: 2.5,
          resilienceRevenueAverage: 550,
        },
        lowerHalf: { count: index + 2, rate: (index + 2) / 12 },
        nonRevenue: {
          highRevenueNoWinCount: index === 1 ? 2 : 0,
          highRevenueNoWinRate: index === 1 ? 0.5 : 0,
          highRevenueTopCount: index === 1 ? 4 : 1,
          rankDelta: index === 0 ? -0.35 : 0.25,
        },
        playOrder: {
          assetsDiff: 200 - index * 80,
          assetsIndex: 1.08 - index * 0.03,
          revenueDiff: 70 - index * 30,
          revenueIndex: 1.12 - index * 0.05,
        },
        podium: { count: 10 - index * 2, rate: (10 - index * 2) / 12 },
        rank: {
          average: averages[index] ?? 0,
          distribution: [1, 2, 3, 4].map((rank) => ({ count: 3, rank, rate: 0.25 })),
          standardDeviation: 0.72 + index * 0.1,
        },
        revenue: { average: 820 - index * 80, max: 3200 - index * 250, median: 760 },
        stability: { rankStandardDeviation: 0.72 + index * 0.1 },
      },
    })),
    players,
    schemaVersion: 1,
    scope: {
      gameTitleId: "gt_momotetsu_2",
      gameTitleName: "桃太郎電鉄2",
      layoutFamily: "momotetsu_2",
      scopeKind: "overall",
      scopeName: "総合",
    },
    trends: {
      ginjiCumulativeCount: trend([0, 1, 1, 2]),
      lowerHalfCumulativeRate: trend([0.1, 0.2, 0.25, 0.35]),
      podiumCumulativeRate: trend([0.9, 0.8, 0.7, 0.6]),
      rankCumulativeAverage: trend(averages),
    },
  };
}

function trend(values: number[]) {
  return players.map((player, playerIndex) => ({
    memberId: player.memberId,
    points: values.map((value, index) => ({
      index: index + 1,
      matchId: `match-${index + 1}`,
      playedAt: "2026-05-10T12:00:00.000Z",
      value: value + playerIndex * 0.1,
    })),
  }));
}

function histogram() {
  return {
    bins: [
      { index: 0, label: "0-999", lowerInclusive: 0, upperExclusive: 1000 },
      { index: 1, label: "1000-1999", lowerInclusive: 1000, upperExclusive: 2000 },
      { index: 2, label: "2000+", lowerInclusive: 2000 },
    ],
    series: players.map((player, index) => ({
      counts: [index + 1, 3, 4 - index],
      memberId: player.memberId,
    })),
  };
}
