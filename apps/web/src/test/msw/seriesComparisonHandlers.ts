import { http, HttpResponse } from "msw";

import type {
  SeriesComparisonResponse,
  SeriesComparisonReviewResponse,
} from "@/shared/api/seriesComparison";

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
  http.get("/api/analytics/series-comparison/review", () =>
    HttpResponse.json(makeSeriesComparisonReviewResponse()),
  ),
];

export function makeSeriesComparisonResponse(): SeriesComparisonResponse {
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
    momentumSwitch: {
      entries: players.map((player, index) => momentumSwitchEntry(player.memberId, index)),
    },
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
    assetStyleProfiles: {
      blowoutWinThreshold: 4200,
      entries: players.map((player, index) => assetStyleProfile(player.memberId, index)),
      heavyLossThreshold: 7800,
      highAssetThreshold: 7600,
      lowAssetThreshold: 900,
      nearMissSecondThreshold: 850,
    },
    cardShopDestination: {
      entries: players.map((player, index) => cardShopDestinationEntry(player.memberId, index)),
    },
    players,
    schemaVersion: 8,
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

function momentumSwitchEntry(
  memberId: string,
  index: number,
): NonNullable<SeriesComparisonResponse["momentumSwitch"]["entries"]>[number] {
  const afterLowerTarget = Math.max(7, 10 - index);
  const afterFourthTarget = [8, 8, 7, 9][index] ?? 8;
  const afterPodiumTarget = [9, 10, 8, 7][index] ?? 8;
  const afterLowerSuccess = [7, 5, 4, 3][index] ?? 4;
  const afterFourthSuccess = [4, 3, 2, 6][index] ?? 3;
  const afterPodiumSuccess = [6, 3, 4, 5][index] ?? 4;
  return {
    afterFourth: momentumRate(afterFourthTarget, afterFourthSuccess, 0.58 - index * 0.06),
    afterLower: momentumRate(afterLowerTarget, afterLowerSuccess, 0.62 - index * 0.08),
    afterPodium: momentumRate(afterPodiumTarget, afterPodiumSuccess, 0.38 + index * 0.04),
    denominator: 12,
    memberId,
    transitionCount: 11,
    transitionRows: [1, 2, 3, 4].map((previousRank) => {
      const targetCount = [3, 3, 2, 3][previousRank - 1] ?? 0;
      return {
        cells: momentumTransitionCells(previousRank, targetCount, index),
        previousRank,
        status: targetCount >= 8 ? "ok" : targetCount > 0 ? "reference" : "no_target",
        targetCount,
      };
    }),
  };
}

function momentumTransitionCells(previousRank: number, targetCount: number, index: number) {
  const ranks = [1, 2, 3, 4];
  const rotation = (previousRank + index) % ranks.length;
  const orderedRanks = [...ranks.slice(rotation), ...ranks.slice(0, rotation)];
  const first = Math.ceil(targetCount / 2);
  const second = Math.floor((targetCount - first) / 2);
  const third = targetCount - first - second;
  const countsByRank = new Map([
    [orderedRanks[0]!, first],
    [orderedRanks[1]!, second],
    [orderedRanks[2]!, third],
    [orderedRanks[3]!, 0],
  ]);
  return ranks.map((nextRank) => {
    const count = countsByRank.get(nextRank) ?? 0;
    return targetCount > 0
      ? {
          count,
          nextRank,
          rate: count / targetCount,
        }
      : {
          count,
          nextRank,
        };
  });
}

function momentumRate(targetCount: number, successCount: number, baselineRate: number) {
  const rate = targetCount > 0 ? successCount / targetCount : undefined;
  return rate === undefined
    ? {
        baselineRate,
        status: targetCount >= 8 ? "ok" : targetCount > 0 ? "reference" : "no_target",
        successCount,
        targetCount,
      }
    : {
        baselineRate,
        deltaFromBaseline: rate - baselineRate,
        rate,
        status: targetCount >= 8 ? "ok" : targetCount > 0 ? "reference" : "no_target",
        successCount,
        targetCount,
      };
}

export function makeSeriesComparisonReviewResponse(): SeriesComparisonReviewResponse {
  return {
    baseline: {
      matchCount: 12,
      playerCount: players.length,
      scope: {
        gameTitleId: "gt_momotetsu_2",
        gameTitleName: "桃太郎電鉄2",
        layoutFamily: "momotetsu_2",
        scopeKind: "overall",
        scopeName: "総合",
      },
      status: "ok",
    },
    commonPlaybookTopics: [
      {
        actionHint:
          "収益で上回った試合は、目的地到着、事故後の入賞維持、終盤の資産防衛のどれが順位差に近いかを振り返ります。",
        affectedPlayerCount: 3,
        category: "revenue",
        id: "common-revenue",
        memberDisplayNames: players.slice(0, 3).map((player) => player.displayName),
        status: "ok",
        summary:
          "3人に物件収益先行時の候補が出ています。個人カードには、4人内で差が強い人だけを残しています。",
        title: "収益先行後の勝ち切りが共通論点です",
      },
    ],
    dataQuality: {
      items: [
        {
          denominator: 12,
          hasTies: false,
          metricId: "review.revenue_top",
          playerMemberId: "member_ponta",
          status: "ok",
          targetCount: 7,
        },
      ],
    },
    playbookByPlayer: players.map((player, index) => ({
      cards: [
        playbookCard(player.memberId, index, "reproduce"),
        playbookCard(player.memberId, index, index % 2 === 0 ? "revise" : "verify"),
      ],
      memberDisplayName: player.displayName,
      memberId: player.memberId,
    })),
    schemaVersion: 3,
  };
}

function playbookCard(
  memberId: string,
  index: number,
  classification: "reproduce" | "revise" | "verify",
): NonNullable<
  NonNullable<SeriesComparisonReviewResponse["playbookByPlayer"]>[number]["cards"]
>[number] {
  const isKeep = classification === "reproduce";
  const metricId = isKeep ? "revenue.top.winRate" : "momentumSwitch.afterLowerPodiumRate";
  return {
    actionAdviceScore: isKeep ? 0.82 - index * 0.08 : 0.68 - index * 0.04,
    actionHypothesis: isKeep
      ? "収益先行時は目的地0回で終えない。"
      : "前戦下位の次戦は、収益下位のまま終盤へ入らない。",
    anchorTarget: {
      label: isKeep ? "物件収益と勝ち" : "切り替え力",
      sectionId: isKeep ? "metric-revenue-outcome" : "metric-momentum-switch",
      view: isKeep ? "drivers" : "flow",
    },
    category: isKeep ? "revenue" : "recovery",
    classification,
    dataReason: isKeep
      ? "物件収益トップ時の1位率は57.1%で、本人全体の1位率33.3%を上回ります。落とした収益トップ試合では目的地平均が0.25回で、収益先行時も目的地到着が順位差に効いている可能性があります。"
      : "前戦下位後の入賞率は60.0%で、本人全体の入賞率50.0%との差は+10.0%です。入賞復帰試合の物件収益順位スコア平均は3.40、下位継続試合は2.10で、前戦下位後は収益基盤を作り直す動きが分岐になっている可能性があります。",
    evidence: [
      {
        label: isKeep ? "物件収益トップ時の1位率" : "下位後入賞率",
        metricId,
        status: index > 2 ? "reference" : "ok",
        targetCount: Math.max(3, 7 - index),
        value: isKeep ? "57.1%" : "60.0%",
      },
      {
        label: isKeep ? "本人全体の1位率" : "本人全体の入賞率",
        metricId: isKeep
          ? `review.${classification}.${memberId}.baseline`
          : `review.${classification}.${memberId}.baselinePodium`,
        status: index > 2 ? "reference" : "ok",
        targetCount: 12,
        value: isKeep ? "33.3%" : "50.0%",
      },
      {
        label: isKeep ? "勝てた収益トップ時の目的地平均" : "復帰時の収益順位差",
        metricId: isKeep
          ? `review.${classification}.${memberId}.wonDestination`
          : `review.${classification}.${memberId}.recoveryRevenueDriver`,
        status: "reference",
        targetCount: 3,
        value: isKeep ? "1.33回" : "+0.62",
      },
      {
        label: isKeep ? "落とした収益トップ時の目的地平均" : "復帰/下位継続件数",
        metricId: isKeep
          ? `review.${classification}.${memberId}.missedDestination`
          : `review.${classification}.${memberId}.recoveryOutcomeCounts`,
        status: "reference",
        targetCount: 4,
        value: isKeep ? "0.25回" : "6件 / 4件",
      },
      {
        label: isKeep ? "落とした収益トップ時の銀次平均" : "下位後入賞率の下振れ込み目安",
        metricId: isKeep
          ? `review.${classification}.${memberId}.missedGinji`
          : `review.${classification}.${memberId}.wilsonLower`,
        status: "reference",
        targetCount: 4,
        value: isKeep ? "0.50回" : "31.3%",
      },
    ],
    avoidAction: isKeep
      ? "収益トップだから安全と見て、目的地0回のまま終盤へ入ること。"
      : "目的地が遠いまま、収益も作らず逆転待ちで終盤へ入ること。",
    id: `${memberId}-${classification}`,
    postMatchCheck: isKeep
      ? "次回、収益で上位だった試合を対象に、目的地0回で終えたか、入賞または下位回避できたかを振り返る。"
      : "次回、前戦下位後の試合を対象に、物件収益順位を戻せたか、入賞圏へ戻せたかを振り返る。",
    recommendedAction: isKeep
      ? "追加収益より、目的地周辺への位置取り、到着、下位回避を優先する。"
      : "目的地だけを追い続ける前に、収益基盤と総資産を残す動きで2位圏へ戻す。",
    status: index > 2 ? "reference" : "ok",
    targetCount: Math.max(3, 7 - index),
    triggerCondition: isKeep
      ? "中盤以降、物件収益で上位だが目的地到着がないとき。"
      : "前戦が3位以下で、目的地が遠く物件収益順位も下がっていると感じるとき。",
  };
}

function cardShopDestinationEntry(memberId: string, index: number) {
  const quadrants = [
    quadrant("destination_with_shop", 3 + (index % 2), 12, 1.7 + index * 0.12, 6200 - index * 360),
    quadrant("destination_without_shop", 2 + index, 12, 2.0 + index * 0.1, 5200 - index * 280),
    quadrant(
      "no_destination_with_shop",
      Math.max(2, 5 - index),
      12,
      2.25 + index * 0.16,
      4800 - index * 220,
    ),
    quadrant(
      "no_destination_without_shop",
      Math.max(1, 2 + (index % 2)),
      12,
      2.8 + index * 0.18,
      2600 - index * 180,
    ),
  ];
  const cardShopMatchCount = quadrants
    .filter(
      (item) => item.kind === "destination_with_shop" || item.kind === "no_destination_with_shop",
    )
    .reduce((sum, item) => sum + item.targetCount, 0);
  const cardShopWithoutDestinationCount =
    quadrants.find((item) => item.kind === "no_destination_with_shop")?.targetCount ?? 0;
  return {
    cardShopMatchCount,
    cardShopRate: cardShopMatchCount / 12,
    cardShopWithoutDestinationCount,
    cardShopWithoutDestinationRate:
      cardShopMatchCount > 0 ? cardShopWithoutDestinationCount / cardShopMatchCount : 0,
    denominator: 12,
    memberId,
    quadrants,
  };
}

function quadrant(
  kind: string,
  targetCount: number,
  denominator: number,
  averageRank: number,
  averageAssets: number,
) {
  return {
    averageAssets,
    averageRank,
    averageRevenue: Math.round(averageAssets * 0.26),
    kind,
    podiumRate: Math.max(0.1, Math.min(1, (5 - averageRank) / 4)),
    rate: targetCount / denominator,
    status: targetCount <= 0 ? "no_target" : targetCount < 3 ? "reference" : "ok",
    targetCount,
    winRate: Math.max(0, Math.min(1, (3 - averageRank) / 4)),
  };
}

function assetStyleProfile(memberId: string, index: number) {
  const kinds = [
    "asset_explosion",
    "close_collector",
    "steady_accumulator",
    "high_risk_breakthrough",
  ];
  const shapes = ["two_tailed", "thin_right_tail", "upper_side", "lower_tail"];
  const tags = [
    ["high_variance"],
    ["mobility_collecting", "close_finish"],
    ["upper_chaser", "property_base"],
    ["downside_risk", "card_base"],
  ];
  const secondaryKind = tags[index]?.[0];
  return {
    memberId,
    metrics: {
      averageRevenueAssetRate: 0.34 - index * 0.025,
      blowoutWinCount: Math.max(0, 4 - index),
      destinationAverage: 0.35 + index * 0.08,
      destinationPositiveRate: 0.25 + index * 0.08,
      heavyLossCount: index + 1,
      highAssetCount: Math.max(1, 5 - index),
      highAssetRate: Math.max(0.05, 0.36 - index * 0.07),
      lowAssetCount: index + 1,
      lowAssetRate: 0.08 + index * 0.05,
      lowerHalfMedianGap: 4200 + index * 900,
      lowerHalfRate: 0.2 + index * 0.1,
      medianAssets: 4200 - index * 350,
      nearMissSecondCount: index + 1,
      p10Assets: 700 + index * 120,
      p90Assets: 8200 - index * 500,
      p90P10Spread: 7500 - index * 620,
      podiumRate: Math.max(0.3, 0.82 - index * 0.12),
      secondCount: 3 + index,
      secondMedianGap: 900 + index * 180,
      secondRate: (3 + index) / 12,
      winCount: Math.max(1, 5 - index),
      winMedianAssets: 7200 - index * 550,
      winMedianMargin: 2600 - index * 420,
      winRate: Math.max(1, 5 - index) / 12,
    },
    primaryKind: kinds[index] ?? "balanced",
    shapeKind: shapes[index] ?? "middle_heavy",
    status: "ok",
    tags: tags[index] ?? [],
    targetCount: 12,
    ...(secondaryKind ? { secondaryKind } : {}),
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
    status: targetCount <= 0 ? "no_target" : targetCount < 3 ? "reference" : "ok",
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
