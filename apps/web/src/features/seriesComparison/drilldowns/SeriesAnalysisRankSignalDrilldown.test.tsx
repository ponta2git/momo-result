import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { RankSignalDrilldown } from "@/features/seriesComparison/drilldowns/SeriesAnalysisRankSignalDrilldown";
import { makeSeriesAnalysisDrilldown } from "@/test/msw/seriesAnalysisFixtures";

describe("RankSignalDrilldown", () => {
  it("shows the decision path before optional method and fold values", async () => {
    const user = userEvent.setup();
    const response = makeSeriesAnalysisDrilldown("rankAnalysis.rankSignals");
    if (response.payload.kind !== "rank_signals") throw new Error("unexpected fixture");

    render(<RankSignalDrilldown payload={response.payload} />);

    expect(
      within(screen.getByLabelText("順位を読む手掛かりの分析範囲")).getByText("5/5組で改善"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "判断の順序" })).toBeInTheDocument();
    const usage = screen.getByLabelText("順位を読む手掛かりの使い方");
    expect(within(usage).getByText("候補を選ぶ")).toBeInTheDocument();
    expect(within(usage).getByText(/試合後に同じ傾向が続いたか確認/u)).toBeInTheDocument();

    const candidate = screen.getByRole("article", { name: "物件収益の検証結果" });
    expect(within(candidate).getByText("候補はこの1件")).toBeInTheDocument();
    expect(within(candidate).getByText("5/5組")).toBeInTheDocument();

    const support = screen.getByRole("list", { name: "物件収益の別開催での支持" });
    expect(within(support).getAllByRole("listitem")).toHaveLength(5);
    for (const supported of within(support).getAllByText("支持")) {
      expect(supported).toHaveClass("text-[var(--color-analysis-positive)]");
    }

    await user.click(screen.getByRole("button", { name: "別開催テストと採用基準" }));
    expect(screen.getByRole("heading", { name: "検証の流れ" })).toBeInTheDocument();
    expect(screen.getByText("候補を作る")).toBeInTheDocument();
    expect(screen.getByText("4組を使用")).toBeInTheDocument();
    expect(screen.getByText("別開催で確かめる")).toBeInTheDocument();
    expect(screen.getByText("残した1組を使用")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "採用基準" })).toBeInTheDocument();
    expect(screen.getByText("重要度 +0.0001以上")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "物件収益の開催別の数値" }));
    const table = screen.getByRole("table", { name: "物件収益の開催別テスト結果" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByRole("cell", { name: "開催A" })).toBeInTheDocument();
  });

  it("gives a next action when no candidate is safe to adopt", () => {
    const response = makeSeriesAnalysisDrilldown("rankAnalysis.rankSignals");
    if (response.payload.kind !== "rank_signals") throw new Error("unexpected fixture");

    render(<RankSignalDrilldown payload={{ ...response.payload, candidates: [] }} />);

    expect(screen.getByText(/順位分布や直接対決を優先してください/u)).toBeInTheDocument();
  });
});
