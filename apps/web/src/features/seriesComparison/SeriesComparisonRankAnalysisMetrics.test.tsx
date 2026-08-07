import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CrownCertaintyMetrics } from "@/features/seriesComparison/metrics/SeriesComparisonCrownCertaintyMetrics";
import { RankSignalMetrics } from "@/features/seriesComparison/metrics/SeriesComparisonRankSignalMetrics";
import { UnexpectedWinMetrics } from "@/features/seriesComparison/metrics/SeriesComparisonUnexpectedWinMetrics";
import {
  makeSeriesComparisonRankAnalysisResponse,
  makeSeriesComparisonResponse,
} from "@/test/msw/seriesComparisonHandlers";

describe("series comparison rank analysis metrics", () => {
  it("shows only stable player-facing rank signals", () => {
    render(
      <MemoryRouter>
        <RankSignalMetrics response={makeSeriesComparisonRankAnalysisResponse()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "順位を読む手掛かり" })).toBeInTheDocument();
    expect(screen.getByText("開催を外した5回中5回で読み取り改善")).toBeInTheDocument();
    expect(screen.getByText("物件収益が多い試合ほど上位寄り")).toBeInTheDocument();
    expect(screen.getAllByText("最も強い")).toHaveLength(4);
    expect(screen.queryByText("スリの銀次が少ない試合ほど上位寄り")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("rank-bt-v1");
    expect(document.body).not.toHaveTextContent("more_is_higher");
  });

  it("renders crown support as one 100 percent composition, not a win probability", () => {
    render(
      <MemoryRouter>
        <CrownCertaintyMetrics response={makeSeriesComparisonRankAnalysisResponse()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("img", { name: "王座支持の構成比" })).toBeInTheDocument();
    expect(screen.getByText("46.0%")).toBeInTheDocument();
    expect(screen.getByText("34.0%")).toBeInTheDocument();
    expect(screen.getByText("14.0%")).toBeInTheDocument();
    expect(screen.getByText("6.0%")).toBeInTheDocument();
    expect(screen.getByText("標本間の首位交代 31回")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("勝率 46.0%");
  });

  it("summarizes an unexpected win with its observed evidence", () => {
    render(
      <MemoryRouter>
        <UnexpectedWinMetrics response={makeSeriesComparisonRankAnalysisResponse()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "記録外の一撃" })).toBeInTheDocument();
    expect(screen.getByText("3/14勝")).toBeInTheDocument();
    expect(screen.getByText("推定3.1位 → 実際1位")).toBeInTheDocument();
    expect(screen.getByText(/第4試合・物件収益 420万円・目的地0回/u)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("運勝ち");
  });

  it("keeps insufficient data local to the advanced metric", () => {
    render(
      <MemoryRouter>
        <RankSignalMetrics response={makeSeriesComparisonResponse()} />
      </MemoryRouter>,
    );

    expect(screen.getByText("対象なし")).toBeInTheDocument();
    expect(
      screen.getByText("補助分析には32戦・8開催以上が必要です。現在は12戦・3開催です。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/5分割中/u)).not.toBeInTheDocument();
  });
});
