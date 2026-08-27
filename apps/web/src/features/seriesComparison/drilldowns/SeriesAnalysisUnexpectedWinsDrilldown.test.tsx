import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { UnexpectedWinsDrilldown } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownContent";
import { makeSeriesAnalysisDrilldown } from "@/test/msw/seriesAnalysisFixtures";

describe("UnexpectedWinsDrilldown", () => {
  it("shows every retained evidence field", () => {
    const response = makeSeriesAnalysisDrilldown("rankAnalysis.unexpectedWins");
    if (response.payload.kind !== "unexpected_wins") throw new Error("unexpected fixture");

    render(
      <MemoryRouter>
        <UnexpectedWinsDrilldown payload={response.payload} />
      </MemoryRouter>,
    );

    const table = screen.getByRole("table", { name: "予測より上位だった勝利の根拠" });
    expect(within(table).getAllByRole("rowheader")).not.toHaveLength(0);
    for (const heading of [
      "物件収益",
      "目的地",
      "プラス駅",
      "マイナス駅",
      "カード駅",
      "カード売り場",
      "スリの銀次",
    ]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
  });
});
