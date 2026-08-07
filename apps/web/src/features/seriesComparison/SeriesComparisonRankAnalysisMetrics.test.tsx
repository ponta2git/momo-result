import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CrownCertaintyMetrics } from "@/features/seriesComparison/metrics/SeriesComparisonCrownCertaintyMetrics";
import { RankSignalMetrics } from "@/features/seriesComparison/metrics/SeriesComparisonRankSignalMetrics";
import { UnexpectedWinMetrics } from "@/features/seriesComparison/metrics/SeriesComparisonUnexpectedWinMetrics";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { makeSeriesComparisonResponse } from "@/test/msw/seriesComparisonHandlers";

function makeRankAnalysisResponse(): SeriesComparisonResponse {
  const response = makeSeriesComparisonResponse();
  const players = response.players ?? [];
  response.matchCount = 40;
  response.rankAnalysis = {
    crownCertainty: {
      bootstrapIterations: 128,
      leaderChangeCount: 31,
      shares: players.map((player, index) => ({
        memberId: player.memberId,
        share: [0.46, 0.34, 0.14, 0.06][index] ?? 0,
      })),
      status: "ok",
      successfulIterations: 128,
    },
    foldScores: [],
    heldEventCount: 20,
    improvedFoldCount: 5,
    matchCount: 40,
    modelVersion: "rank-bt-v1",
    rankSignalsByPlayer: players.map((player, index) => ({
      memberId: player.memberId,
      signals:
        index === 0
          ? [
              {
                direction: "more_is_higher",
                importance: 0.08,
                signal: "revenue",
                stable: true,
              },
              {
                direction: "less_is_higher",
                importance: 0.03,
                signal: "ginji",
                stable: false,
              },
            ]
          : [
              {
                direction: index === 2 ? "less_is_higher" : "more_is_higher",
                importance: 0.06 - index * 0.01,
                signal: ["destination", "minus_station", "card_shop"][index - 1] ?? "destination",
                stable: true,
              },
            ],
      status: "ok",
    })),
    reasonCodes: [],
    status: "ok",
    unexpectedWinsByPlayer: players.map((player, index) => {
      if (index === 0) {
        return {
          hasDetails: true,
          latest: {
            actualRank: 1,
            evidence: {
              cardShopCount: 1,
              cardStationCount: 2,
              destinationCount: 0,
              ginjiCount: 0,
              minusStationCount: 1,
              plusStationCount: 3,
              revenueManYen: 420,
            },
            expectedRank: 3.08,
            heldEventId: "held_2026_05_17",
            matchId: "match-12",
            matchNoInEvent: 4,
            playedAt: "2026-05-17T14:00:00.000Z",
          },
          memberId: player.memberId,
          status: "ok",
          totalWinCount: 14,
          unexpectedWinCount: 3,
        };
      }
      return {
        hasDetails: false,
        memberId: player.memberId,
        status: index === 3 ? "reference" : "ok",
        totalWinCount: [11, 10, 5][index - 1] ?? 0,
        unexpectedWinCount: [2, 1, 0][index - 1] ?? 0,
      };
    }),
  };
  return response;
}

describe("series comparison rank analysis metrics", () => {
  it("shows only stable player-facing rank signals", () => {
    render(<RankSignalMetrics response={makeRankAnalysisResponse()} />);

    expect(screen.getByRole("heading", { name: "順位を読む手掛かり" })).toBeInTheDocument();
    expect(screen.getByText("物件収益が多い試合ほど上位寄り")).toBeInTheDocument();
    expect(screen.getAllByText("最も強い")).toHaveLength(4);
    expect(screen.queryByText("スリの銀次が少ない試合ほど上位寄り")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("rank-bt-v1");
    expect(document.body).not.toHaveTextContent("more_is_higher");
  });

  it("renders crown support as one 100 percent composition, not a win probability", () => {
    render(<CrownCertaintyMetrics response={makeRankAnalysisResponse()} />);

    expect(screen.getByRole("img", { name: "王座支持の構成比" })).toBeInTheDocument();
    expect(screen.getByText("46.0%")).toBeInTheDocument();
    expect(screen.getByText("34.0%")).toBeInTheDocument();
    expect(screen.getByText("14.0%")).toBeInTheDocument();
    expect(screen.getByText("6.0%")).toBeInTheDocument();
    expect(screen.getByText("標本間の首位交代 31回")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("勝率 46.0%");
  });

  it("summarizes an unexpected win with its observed evidence", () => {
    render(<UnexpectedWinMetrics response={makeRankAnalysisResponse()} />);

    expect(screen.getByRole("heading", { name: "記録外の一撃" })).toBeInTheDocument();
    expect(screen.getByText("3/14勝")).toBeInTheDocument();
    expect(screen.getByText("推定3.1位 → 実際1位")).toBeInTheDocument();
    expect(screen.getByText(/第4試合・物件収益 420万円・目的地0回/u)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("運勝ち");
  });

  it("keeps insufficient data local to the advanced metric", () => {
    render(<RankSignalMetrics response={makeSeriesComparisonResponse()} />);

    expect(screen.getByText("対象なし")).toBeInTheDocument();
    expect(
      screen.getByText("補助分析には32戦・8開催以上が必要です。現在は12戦・3開催です。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/5分割中/u)).not.toBeInTheDocument();
  });
});
