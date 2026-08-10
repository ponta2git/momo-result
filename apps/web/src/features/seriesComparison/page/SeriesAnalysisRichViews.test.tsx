import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { headToHeadCellStyle } from "@/features/seriesComparison/charts/SeriesAnalysisOverviewCharts";
import { ContextView } from "@/features/seriesComparison/page/SeriesAnalysisContextView";
import { DriversView } from "@/features/seriesComparison/page/SeriesAnalysisDriversView";
import { FlowView } from "@/features/seriesComparison/page/SeriesAnalysisFlowView";
import { OverviewView } from "@/features/seriesComparison/page/SeriesAnalysisOverviewView";
import { SeriesAnalysisSelectedMatch } from "@/features/seriesComparison/page/SeriesAnalysisSelectedMatch";
import {
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisMatchContext,
} from "@/test/msw/seriesAnalysisFixtures";

describe("rich series analysis views", () => {
  it("leads with conclusions and marks the selected match in the overview", () => {
    const response = makeSeriesAnalysisAggregate();
    render(
      <OverviewView
        focusedItemIds={["rank-distribution:member_ponta:1"]}
        response={response}
        onDrilldown={vi.fn()}
      />,
    );

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(["順位と基礎比較", "平均順位首位の確からしさ", "直接対決", "順位の安定性"]);
    const currentDifference = screen.getByLabelText("現在の順位差");
    expect(within(currentDifference).getByText("平均順位の先頭")).toBeInTheDocument();
    expect(within(currentDifference).getByText("先頭と最後尾の平均順位差")).toBeInTheDocument();
    expect(document.querySelector('[data-focused-metric="true"]')).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/1位 6回 50%、この試合/u),
    );
    expect(document.body).not.toHaveTextContent(/member_ponta|property_focused|rank\.average/u);
  });

  it("places observed outcomes before advanced rank signals", () => {
    const response = makeSeriesAnalysisAggregate();
    render(
      <MemoryRouter initialEntries={["/analytics/series?view=drivers"]}>
        <DriversView
          focusedItemIds={["revenue-rank:member_ponta:1:1"]}
          response={response}
          onDrilldown={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      "資産の残し方",
      "物件収益と最終順位",
      "目的地到着と順位",
      "試合ごとの資産と収益",
      "順位を読む追加の手掛かり",
    ]);
    expect(
      screen.getByRole("img", { name: /収益1位から最終1位、4戦、80%、この試合/u }),
    ).toHaveAttribute("data-focused-metric", "true");
    expect(screen.getAllByText(/桃鉄型（物件重視）/u)).not.toHaveLength(0);
    expect(screen.getByText("総資産の出方")).toBeInTheDocument();
    expect(screen.getByText("稼ぎ方の比重")).toBeInTheDocument();
    expect(screen.getByText("主要根拠")).toBeInTheDocument();
    expect(screen.getByText("総資産レンジ")).toBeInTheDocument();
    expect(screen.getByText("物件収益額")).toBeInTheDocument();
    expect(screen.getByText("4億5000万円")).toBeInTheDocument();
    expect(screen.getByText("0円")).toBeInTheDocument();
    expect(screen.getByText("1万円〜9999万円")).toBeInTheDocument();
    expect(screen.queryByText("0〜9999")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /12戦目、12%、21億円、1位の試合結果を見る/u,
      }),
    ).toHaveAttribute("href", expect.stringContaining("/matches/match-12?returnTo="));
    expect(
      screen.queryByText(/因果関係や次戦の結果を保証するものではありません/u),
    ).not.toBeInTheDocument();
  });

  it("uses readable condition names for focused contextual evidence", () => {
    render(
      <ContextView
        focusedItemIds={["card-shop:member_ponta:destination_with_shop"]}
        response={makeSeriesAnalysisAggregate()}
        onDrilldown={vi.fn()}
      />,
    );

    expect(screen.getByText("目的地あり・売り場あり・この試合")).toBeInTheDocument();
    expect(document.querySelector('[data-focused-metric="true"]')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("destination_with_shop");
    expect(screen.getByText("得意")).toBeInTheDocument();
  });

  it("restores match-axis strips and the event-position matrix with result links", () => {
    const response = makeSeriesAnalysisAggregate();
    const recent = response.recentRanks[0];
    if (!recent) throw new Error("recent rank fixture is required");
    recent.rows = Array.from({ length: 20 }, (_, index) => {
      const matchIndex = index + 1;
      return {
        itemId: `recent-rank:member_ponta:match-${matchIndex}`,
        matchId: `match-${matchIndex}`,
        playedAt: `2026-07-${String(matchIndex).padStart(2, "0")}T12:00:00.000Z`,
        rank: ((index % 4) + 1) as 1 | 2 | 3 | 4,
      };
    });
    recent.targetCount = 20;
    recent.usedFallback = false;
    render(
      <MemoryRouter initialEntries={["/analytics/series?view=flow"]}>
        <FlowView
          focusedItemIds={["match:match-12", "recent-rank:member_ponta:match-12"]}
          response={response}
          onDrilldown={vi.fn()}
          onFocusMatch={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("table", { name: "直近順位ストリップ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "直近20戦" })).toBeInTheDocument();
    const selectedRankLink = screen.getByRole("link", {
      name: /ぽんた、第12戦、4位、この試合。試合結果を見る/u,
    });
    expect(selectedRankLink).toHaveAttribute(
      "href",
      expect.stringContaining("/matches/match-12?returnTo="),
    );
    expect(selectedRankLink).toHaveClass("size-11");
    expect(within(selectedRankLink).getByText("4")).toHaveAttribute("data-rank-tile-fill", "true");
    expect(
      screen.getAllByRole("link", { name: /ぽんた、第\d+戦、\d位.*試合結果を見る/u }),
    ).toHaveLength(20);
    expect(screen.getByText("行: 前戦")).toBeInTheDocument();
    expect(screen.getByText("列: 次戦")).toBeInTheDocument();
    expect(screen.getByText("第1試合")).toBeInTheDocument();
    expect(screen.getByText("第2試合")).toBeInTheDocument();
    expect(screen.getByText("第4試合")).toBeInTheDocument();
    expect(screen.getByText("1位–4位差")).toBeInTheDocument();
    expect(screen.queryByText(/前の試合の順位から次の順位へ移った件数/u)).not.toBeInTheDocument();
  });

  it("assigns disadvantage and advantage to different semantic colors", () => {
    expect(headToHeadCellStyle("strong_advantage", "high").backgroundColor).toContain(
      "--color-action",
    );
    expect(headToHeadCellStyle("strong_disadvantage", "high").backgroundColor).toContain(
      "--color-danger",
    );
  });

  it("keeps the selected match inline with its ledger and an explicit clear action", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <MemoryRouter initialEntries={["/analytics/series?view=flow"]}>
        <SeriesAnalysisSelectedMatch context={makeSeriesAnalysisMatchContext()} onClear={onClear} />
      </MemoryRouter>,
    );

    const selectedMatch = screen.getByRole("region", { name: "選択中の試合" });
    expect(within(selectedMatch).getByRole("heading", { name: /第12戦/u })).toBeInTheDocument();
    expect(
      within(selectedMatch).getByRole("link", { name: "第12戦の試合結果を見る" }),
    ).toHaveAttribute("href", expect.stringContaining("/matches/match-12?returnTo="));
    expect(
      within(selectedMatch).getByRole("list", { name: "選択中の試合の順位と成績" }),
    ).toBeInTheDocument();
    expect(within(selectedMatch).getByText("上位が接戦")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(within(selectedMatch).getByRole("button", { name: "選択解除" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
