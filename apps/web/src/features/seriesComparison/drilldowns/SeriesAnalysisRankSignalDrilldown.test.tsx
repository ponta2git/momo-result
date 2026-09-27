import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { RankSignalDrilldown } from "@/features/seriesComparison/drilldowns/SeriesAnalysisRankSignalDrilldown";
import { makeSeriesAnalysisDrilldown } from "@/test/msw/seriesAnalysisFixtures";

describe("RankSignalDrilldown", () => {
  it("keeps candidate support counts and fold results available", async () => {
    const user = userEvent.setup();
    const response = makeSeriesAnalysisDrilldown("rankAnalysis.rankSignals");
    if (response.payload.kind !== "rank_signals") throw new Error("unexpected fixture");

    render(<RankSignalDrilldown payload={response.payload} />);

    const analysisScope = screen.getByLabelText("順位を読む手掛かりの分析範囲");
    expect(within(analysisScope).getByText("5/5組で改善")).toBeInTheDocument();
    expect(within(analysisScope).getByText("別開催テスト")).toBeInTheDocument();
    const candidate = screen.getByRole("article", { name: "物件収益の検証結果" });
    expect(within(candidate).getByText("候補はこの1件")).toBeInTheDocument();
    expect(within(candidate).getByText("5/5組")).toBeInTheDocument();

    const support = screen.getByRole("list", { name: "物件収益の別開催での支持" });
    expect(within(support).getAllByRole("listitem")).toHaveLength(5);
    expect(within(support).getAllByText("支持")).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: "物件収益の開催別の数値" }));
    const table = screen.getByRole("table", { name: "物件収益の開催別テスト結果" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByRole("rowheader", { name: "開催A" })).toHaveAttribute("scope", "row");
  });
});
