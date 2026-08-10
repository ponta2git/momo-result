import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import {
  PlayOrderHistoryDrilldown,
  RankHistoryDrilldown,
} from "@/features/seriesComparison/drilldowns/SeriesAnalysisHistoryDrilldowns";
import { makeSeriesAnalysisDrilldown } from "@/test/msw/seriesAnalysisFixtures";

describe("series analysis history drilldowns", () => {
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
      "対象12戦現在1.75位読み取り十分",
    );
    expect(screen.getByText("0.05 改善")).toBeInTheDocument();
    expect(screen.getByText("順位 1位・改善")).toBeInTheDocument();
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

    expect(
      screen.getByRole("img", { name: "ぽんたの番手別累積平均順位の推移" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("ぽんたの番手別順位推移の要約")).toBeInTheDocument();
    expect(screen.getByText(/2位 → 1.5位/u)).toBeInTheDocument();
    expect(screen.getByText("改善")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第12戦の試合結果を見る" })).toBeInTheDocument();
  });
});
