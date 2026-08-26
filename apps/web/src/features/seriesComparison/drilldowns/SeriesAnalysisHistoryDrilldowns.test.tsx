import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ChangeBadge } from "@/features/seriesComparison/drilldowns/SeriesAnalysisChangeBadge";
import {
  PlayOrderHistoryDrilldown,
  RankHistoryDrilldown,
} from "@/features/seriesComparison/drilldowns/SeriesAnalysisHistoryDrilldowns";
import { makeSeriesAnalysisDrilldown } from "@/test/msw/seriesAnalysisFixtures";

describe("series analysis history drilldowns", () => {
  it("maps improvement and decline to analysis polarity", () => {
    render(
      <>
        <ChangeBadge direction="improved" magnitude={-0.5} />
        <ChangeBadge direction="declined" magnitude={0.5} />
      </>,
    );

    expect(screen.getByText("0.5 改善")).toHaveClass("border-[var(--color-analysis-positive)]/45");
    expect(screen.getByText("0.5 後退")).toHaveClass("border-[var(--color-analysis-negative)]/45");
  });

  it("shows the rank graph, concrete changes, and source-match links", () => {
    const response = makeSeriesAnalysisDrilldown("rank.averageHistory");
    if (response.payload.kind !== "rank_average_history") throw new Error("unexpected fixture");

    render(
      <MemoryRouter initialEntries={["/analytics/series?view=overview"]}>
        <RankHistoryDrilldown payload={response.payload} playerName={response.player.displayName} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("img", { name: "ぽんたの累積平均順位の推移" })).toBeInTheDocument();
    expect(screen.getByLabelText("ぽんたの平均順位推移の要約")).toHaveTextContent(
      /対象12戦.*現在1.75位.*直近開催での通算変化/u,
    );
    expect(screen.queryByText("初戦後からの通算変化")).not.toBeInTheDocument();
    expect(screen.queryByText("十分")).not.toBeInTheDocument();
    expect(screen.getByText("0.05 改善")).toBeInTheDocument();
    expect(screen.getByText("順位 1位・改善")).toBeInTheDocument();
    const eventHistory = screen.getByLabelText("ぽんたの開催別平均順位");
    expect(eventHistory).toHaveTextContent("2026/08/08 21:00");
    expect(eventHistory).toHaveTextContent("2 → 2 → 1 → 1");
    expect(eventHistory).not.toHaveTextContent("event-12");
    expect(
      within(eventHistory).getByRole("columnheader", { name: "開催日時" }),
    ).toBeInTheDocument();
    expect(screen.getByText("直近開催での通算変化")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第12戦の試合結果を見る" })).toHaveAttribute(
      "href",
      expect.stringContaining("/matches/match-12?returnTo="),
    );
  });

  it("shows the play-order graph and before-after magnitude", () => {
    const response = makeSeriesAnalysisDrilldown("playOrder.rankHistory");
    if (response.payload.kind !== "play_order_rank_history") {
      throw new Error("unexpected fixture");
    }

    render(
      <MemoryRouter initialEntries={["/analytics/series?view=context"]}>
        <PlayOrderHistoryDrilldown
          payload={response.payload}
          playerName={response.player.displayName}
        />
      </MemoryRouter>,
    );

    const chart = screen.getByRole("img", { name: "ぽんたの番手別累積平均順位の推移" });
    expect(chart).toBeInTheDocument();
    expect(chart.querySelector('[data-series-id="play-order:1"]')).toBeInTheDocument();
    expect(chart.querySelector('[data-series-id="play-order:4"]')).toBeInTheDocument();
    const chartFigure = chart.closest("figure");
    if (!chartFigure) throw new Error("Expected the play-order chart figure");
    expect(chartFigure.lastElementChild).toHaveTextContent("プレー順1プレー順2プレー順3プレー順4");
    expect(chartFigure.lastElementChild).not.toHaveTextContent(/1番手|4番手/u);
    expect(screen.getByLabelText("ぽんたの番手別順位推移の要約")).toBeInTheDocument();
    expect(document.querySelector('[data-play-order="1"]')).toHaveTextContent("プレー順1");
    expect(screen.getByText(/2位 → 1.5位/u)).toBeInTheDocument();
    expect(screen.getByText("最良番手")).toBeInTheDocument();
    expect(screen.getByText("最悪番手")).toBeInTheDocument();
    expect(screen.getByText(/全体同番手 1.75位・差 -0.25位/u)).toBeInTheDocument();
    expect(screen.getByText("改善")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第12戦の試合結果を見る" })).toBeInTheDocument();
  });
});
