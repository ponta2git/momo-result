import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SeriesAnalysisScopeBar } from "@/features/seriesComparison/page/SeriesAnalysisScopeBar";
import { makeSeriesAnalysisReview } from "@/test/msw/seriesAnalysisFixtures";

const baseProps = {
  canRefresh: true,
  mapOptions: [],
  mapValue: "",
  onMapChange: vi.fn(),
  onRefresh: vi.fn(),
  onSeasonChange: vi.fn(),
  onSeriesChange: vi.fn(),
  refreshing: false,
  scopeLabel: "桃太郎電鉄2・総合",
  seasonOptions: [],
  seasonValue: "",
  seriesOptions: [],
  seriesValue: "gt_momotetsu_2",
};

describe("SeriesAnalysisScopeBar", () => {
  it("does not report healthy quality", () => {
    render(<SeriesAnalysisScopeBar {...baseProps} response={makeSeriesAnalysisReview()} />);

    const control = screen.getByRole("button", { name: "比較条件" });
    expect(control).toHaveTextContent("12戦");
    expect(control).not.toHaveTextContent(/十分|読み取り目安/u);
  });

  it("reports only quality states that need attention", () => {
    const response = makeSeriesAnalysisReview();
    response.dataQuality.summary = { noTargetCount: 2, okCount: 5, referenceCount: 1 };

    render(<SeriesAnalysisScopeBar {...baseProps} response={response} />);

    expect(screen.getByRole("button", { name: "比較条件" })).toHaveTextContent(
      "参考値 1項目・対象なし 2項目",
    );
  });
});
