import { http, HttpResponse } from "msw";

import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

const players = [
  { displayName: "いーゆー", memberId: "member_eu" },
  { displayName: "ぽんた", memberId: "member_ponta" },
  { displayName: "あかねまみ", memberId: "member_akane_mami" },
  { displayName: "おーたか", memberId: "member_otaka" },
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
    headToHead: {
      entries: players.flatMap((subject, subjectIndex) =>
        players.map((opponent, opponentIndex) =>
          subject.memberId === opponent.memberId
            ? {
                betterRankCount: 0,
                matchCount: 0,
                opponentMemberId: opponent.memberId,
                status: "self",
                subjectMemberId: subject.memberId,
              }
            : {
                averageAssetsDiff: (opponentIndex - subjectIndex) * 320,
                averageRankDiff: (opponentIndex - subjectIndex) * 0.35,
                betterRankCount: Math.max(0, 8 - subjectIndex),
                betterRankRate: Math.max(0.1, 0.72 - subjectIndex * 0.12),
                matchCount: 12,
                opponentMemberId: opponent.memberId,
                status: "ok",
                subjectMemberId: subject.memberId,
              },
        ),
      ),
    },
    matchCount: 12,
    matchNoInEventBreakdown: [1, 2, 3, 4, 5].map((matchNoInEvent) => ({
      matchNoInEvent,
      playerRows: players.map((player, index) => ({
        averageRank: Math.min(4, (averages[index] ?? 2.5) + matchNoInEvent * 0.08),
        memberId: player.memberId,
        podiumRate: Math.max(0.1, 0.75 - index * 0.12),
        status: "ok",
        targetCount: 4,
      })),
    })),
    matchPlayerPoints: Array.from({ length: 12 }, (_, matchIndex) =>
      players.map((player, playerIndex) => ({
        assetsRank: playerIndex + 1,
        matchId: `match-${matchIndex + 1}`,
        matchIndex: matchIndex + 1,
        memberId: player.memberId,
        playedAt: "2026-05-10T12:00:00.000Z",
        rank: Math.min(4, Math.max(1, ((matchIndex + playerIndex) % 4) + 1)),
        revenue: 980 - playerIndex * 145 + matchIndex * 20,
        revenueAssetRate:
          (980 - playerIndex * 145 + matchIndex * 20) /
          (2600 - playerIndex * 260 + matchIndex * 110),
        revenueRank: playerIndex + 1,
        totalAssets: 2600 - playerIndex * 260 + matchIndex * 110,
      })),
    ).flat(),
    matchTimeline: Array.from({ length: 12 }, (_, index) => ({
      assetGapFirstToLast: 2400 + index * 120,
      assetGapFirstToSecond: 450 + index * 20,
      flags:
        index % 4 === 0
          ? ["revenue_top_no_win", "ginji_storm"]
          : index % 5 === 0
            ? ["asset_blowout"]
            : [],
      matchId: `match-${index + 1}`,
      matchIndex: index + 1,
      playedAt: "2026-05-10T12:00:00.000Z",
      revenueTopMemberIds: [players[(index + 1) % players.length]!.memberId],
      status: "ok",
      totalGinjiCount: index % 4 === 0 ? 2 : 0,
      winnerMemberId: players[index % players.length]!.memberId,
    })),
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
        destinationOutcome: {
          lowDestination: outcome({
            lowerHalfCount: index,
            podiumCount: Math.max(0, 4 - index),
            targetCount: 5,
            winCount: index === 0 ? 2 : 0,
          }),
          top: outcome({
            lowerHalfCount: index === 2 ? 2 : 1,
            podiumCount: Math.max(1, 5 - index),
            targetCount: 7,
            winCount: Math.max(0, 3 - index),
          }),
          zeroDestination: outcome({
            lowerHalfCount: index + 1,
            podiumCount: Math.max(0, 3 - index),
            targetCount: 4,
            winCount: index === 3 ? 0 : 1,
          }),
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
        revenueOutcome: {
          lowRevenue: outcome({
            lowerHalfCount: index + 1,
            podiumCount: Math.max(0, 3 - index),
            targetCount: 4,
            winCount: index === 0 ? 1 : 0,
          }),
          nonTopWinCount: index === 0 ? 4 : 1,
          top: outcome({
            lowerHalfCount: index === 1 ? 2 : 1,
            podiumCount: Math.max(1, 6 - index),
            targetCount: 7,
            winCount: Math.max(0, 3 - index),
          }),
        },
        playOrder: {
          assetsDiff: 200 - index * 80,
          assetsIndex: 1.08 - index * 0.03,
          breakdown: [1, 2, 3, 4].map((playOrder) => {
            const average = averages[index] ?? 2.5;
            return {
              assetsAverage: 2500 - index * 180 + playOrder * 70,
              matchCount: 3,
              playOrder,
              rankAverage: Math.min(4, Math.max(1, average + (playOrder - 2.5) * 0.22)),
              revenueAverage: 780 - index * 70 + playOrder * 25,
            };
          }),
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
    playerPerformanceProfiles: {
      averageRankScoreMedian: 2.5,
      averageRevenueAssetRateMedian: 0.28,
      entries: players.map((player, index) => ({
        averageRankScore: 3.7 - index * 0.45,
        averageRevenueAssetRate: 0.38 - index * 0.06,
        memberId: player.memberId,
        podiumRate: (10 - index * 2) / 12,
        profileKind:
          index === 0
            ? "steady_leader"
            : index === 1
              ? "swing_leader"
              : index === 2
                ? "steady_chaser"
                : "swing_chaser",
        rankStandardDeviation: 0.62 + index * 0.18,
        status: "ok",
        strategyKind: index === 0 ? "property_focused" : index === 3 ? "card_focused" : "balanced",
      })),
      rankStandardDeviationMedian: 0.85,
    },
    players,
    schemaVersion: 4,
    recentFormByPlayer: players.map((player, index) => ({
      averageRank: (averages[index] ?? 2.5) + 0.15,
      lowerHalfStreak: index === 3 ? 2 : 0,
      memberId: player.memberId,
      podiumRate: Math.max(0.1, 0.8 - index * 0.16),
      podiumStreak: Math.max(0, 4 - index),
      status: "ok",
      targetCount: 8,
      windowSize: 8,
      winStreak: index === 0 ? 2 : 0,
    })),
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
      rankCumulativeStandardDeviation: trend([0, 0.5, 0.75, 0.68]),
    },
  };
}

function outcome({
  lowerHalfCount,
  podiumCount,
  targetCount,
  winCount,
}: {
  lowerHalfCount: number;
  podiumCount: number;
  targetCount: number;
  winCount: number;
}) {
  const safePodiumCount = Math.min(podiumCount, targetCount);
  const safeLowerHalfCount = Math.max(0, targetCount - safePodiumCount);
  const safeWinCount = Math.min(winCount, safePodiumCount);
  const fourth = Math.min(safeLowerHalfCount, lowerHalfCount > 0 ? 1 : 0);
  const third = Math.max(0, safeLowerHalfCount - fourth);
  const second = Math.max(0, safePodiumCount - safeWinCount);
  const first = safeWinCount;
  return {
    lowerHalfCount: safeLowerHalfCount,
    lowerHalfRate: targetCount > 0 ? safeLowerHalfCount / targetCount : 0,
    podiumCount: safePodiumCount,
    podiumRate: targetCount > 0 ? safePodiumCount / targetCount : 0,
    rankDistribution: [
      { count: first, rank: 1, rate: targetCount > 0 ? first / targetCount : 0 },
      { count: second, rank: 2, rate: targetCount > 0 ? second / targetCount : 0 },
      { count: third, rank: 3, rate: targetCount > 0 ? third / targetCount : 0 },
      { count: fourth, rank: 4, rate: targetCount > 0 ? fourth / targetCount : 0 },
    ],
    status: targetCount < 5 ? "reference" : "ok",
    targetCount,
    winCount: safeWinCount,
    winRate: targetCount > 0 ? safeWinCount / targetCount : 0,
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
