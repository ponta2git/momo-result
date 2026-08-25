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
  it("leads with conclusions, names its regions, and gives actionable crown guidance", async () => {
    const user = userEvent.setup();
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
    expect(screen.getByRole("region", { name: "順位と基礎比較" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "直接対決" })).toBeInTheDocument();
    const currentDifference = screen.getByLabelText("現在の順位差");
    expect(within(currentDifference).getByText("平均順位の先頭")).toBeInTheDocument();
    expect(within(currentDifference).getByText("先頭と最後尾の平均順位差")).toBeInTheDocument();
    expect(document.querySelector('[data-focused-metric="true"]')).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/1位 6回 50%、この試合/u),
    );
    expect(screen.getByRole("heading", { name: "各順位の回数" })).toBeInTheDocument();
    expect(screen.getByLabelText("ぽんたの順位回数")).toHaveTextContent(
      "1位 6回（この試合）・2位 2回・3位 2回・4位 2回",
    );
    expect(document.body).not.toHaveTextContent(/member_ponta|property_focused|rank\.average/u);

    const crownRegion = screen.getByRole("region", { name: "平均順位首位の確からしさ" });
    expect(within(crownRegion).getByText("先頭と次点の比率差")).toBeInTheDocument();
    expect(within(crownRegion).getByText("12戦・8開催")).toBeInTheDocument();
    expect(within(crownRegion).queryByText("十分")).not.toBeInTheDocument();
    expect(within(crownRegion).queryByText(/次戦の勝率や最終順位/u)).not.toBeInTheDocument();
    await user.click(
      within(crownRegion).getByRole("button", { name: "平均順位首位の確からしさの読み方" }),
    );
    expect(within(crownRegion).getByText(/次戦の勝率や最終順位/u)).toBeInTheDocument();
    expect(within(crownRegion).getByText(/直接対決.*順位の安定性/u)).toBeInTheDocument();
  });

  it("places observed outcomes before advanced rank signals and connects guidance to evidence", async () => {
    const user = userEvent.setup();
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
      screen.getByRole("cell", { name: /収益1位から最終1位、4戦、80%、この試合/u }),
    ).toHaveAttribute("data-focused-metric", "true");
    const revenueMatrix = screen.getByRole("table", {
      name: "ぽんたの物件収益順位と最終順位",
    });
    expect(within(revenueMatrix).getAllByRole("row")).toHaveLength(5);
    expect(within(revenueMatrix).getAllByRole("rowheader")).toHaveLength(4);
    expect(within(revenueMatrix).getAllByRole("cell")).toHaveLength(16);
    expect(screen.getByLabelText("物件収益と最終順位のセルの読み方")).toHaveTextContent(
      "同じ物件収益順位の中で、その最終順位になった割合",
    );
    expect(screen.getAllByText(/桃鉄型（物件重視）/u)).not.toHaveLength(0);
    expect(screen.getByText("総資産の出方")).toBeInTheDocument();
    expect(screen.getByText("稼ぎ方の比重")).toBeInTheDocument();
    expect(screen.getByText("主要根拠")).toBeInTheDocument();
    expect(screen.getByText("総資産レンジ")).toBeInTheDocument();
    expect(screen.getByText("物件収益額")).toBeInTheDocument();
    expect(screen.getByText("補助傾向: 物件基盤")).toBeInTheDocument();
    expect(screen.getByText("目的地を重ねる")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ぽんたの資産傾向の詳しい根拠" }));
    expect(screen.getByText("勝利時の2位差中央")).toBeInTheDocument();
    expect(screen.getByText(/大勝 8億円.*惜しい2位 2億円.*大敗 12億円/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "収益と順位の詳細" }));
    expect(screen.getByText("収益順位だけでは説明しない順位差")).toBeInTheDocument();
    expect(screen.getByText("収益1位以外からの勝利")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "目的地と順位の詳細" }));
    expect(screen.getByText("到着多寡による入賞率差")).toBeInTheDocument();
    expect(screen.getByText("目的地への依存度")).toBeInTheDocument();
    expect(screen.getByText(/候補はこの1件.*別開催で支持 5組/u)).toBeInTheDocument();
    expect(screen.getByText("4億5000万円")).toBeInTheDocument();
    expect(screen.getByText("0円")).toBeInTheDocument();
    expect(screen.getByText("1万円〜9999万円")).toBeInTheDocument();
    expect(screen.queryByText("0〜9999")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /第12戦、12%、21億円、1位の試合結果を見る/u,
      }),
    ).toHaveAttribute("href", expect.stringContaining("/matches/match-12?returnTo="));
    expect(
      screen.queryByText(/因果関係や次戦の結果を保証するものではありません/u),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "順位を読む追加の手掛かりの読み方" }));
    expect(screen.getByText(/開催別の残り方と根拠試合を確かめる/u)).toBeInTheDocument();
    expect(screen.getByText(/次戦の順位確率としては使わない/u)).toBeInTheDocument();
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
    expect(screen.getByText(/売り場あり 5\/12戦・目的地なし20%/u)).toBeInTheDocument();
    expect(screen.getByText("平均収益")).toBeInTheDocument();
    expect(document.querySelector('[data-focused-metric="true"]')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("destination_with_shop");
    expect(screen.getByText("得意")).toBeInTheDocument();
    expect(screen.getByText("複数回遭遇した試合")).toBeInTheDocument();
    expect(screen.getByText("1試合の最多遭遇")).toBeInTheDocument();
    expect(screen.getByText("遭遇時平均収益")).toBeInTheDocument();
    const playOrderMatrix = screen.getByRole("table", { name: "番手別成績" });
    expect(within(playOrderMatrix).getAllByRole("columnheader")).toHaveLength(5);
    expect(within(playOrderMatrix).getAllByRole("cell")).toHaveLength(4);
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
    expect(within(selectedRankLink).getByText("4")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", {
        name: /ぽんた、対戦順未設定、\d位.*試合結果を見る/u,
      }),
    ).toHaveLength(19);
    expect(screen.getByText("行: 前戦")).toBeInTheDocument();
    expect(screen.getByText("列: 次戦")).toBeInTheDocument();
    const momentumMatrix = screen.getByRole("table", { name: "ぽんたの順位の切り替わり" });
    expect(within(momentumMatrix).getAllByRole("row")).toHaveLength(5);
    expect(within(momentumMatrix).getAllByRole("cell")).toHaveLength(16);
    expect(screen.getByLabelText("順位の切り替わりのセルの読み方")).toHaveTextContent(
      "同じ前戦順位から、その次戦順位になった割合",
    );
    expect(screen.getByText(/連勝 1・連続入賞 2・連続下位 0/u)).toBeInTheDocument();
    expect(screen.getByText("下位の次に入賞")).toBeInTheDocument();
    expect(screen.getByText(/2\/4戦・50%/u)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "直近20戦" })).toBeInTheDocument();
    expect(screen.getByText("第1試合")).toBeInTheDocument();
    expect(screen.getByText("第2試合")).toBeInTheDocument();
    expect(screen.getByText("第4試合")).toBeInTheDocument();
    const matchNoMatrix = screen.getByRole("table", {
      name: "開催内第1試合から第4試合の傾向",
    });
    expect(within(matchNoMatrix).getAllByRole("row")).toHaveLength(5);
    expect(screen.getByText("1位–4位差")).toBeInTheDocument();
    expect(screen.queryByText(/前の試合の順位から次の順位へ移った件数/u)).not.toBeInTheDocument();
  });

  it("does not invent a recent-window size when the artifact has no recent ranks", () => {
    const response = makeSeriesAnalysisAggregate();
    response.recentRanks = [];
    render(
      <MemoryRouter initialEntries={["/analytics/series?view=flow"]}>
        <FlowView
          focusedItemIds={[]}
          response={response}
          onDrilldown={vi.fn()}
          onFocusMatch={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("region", { name: "直近順位" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "直近20戦" })).not.toBeInTheDocument();
    expect(screen.getByText("直近順位の対象試合はありません。")).toBeInTheDocument();
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
