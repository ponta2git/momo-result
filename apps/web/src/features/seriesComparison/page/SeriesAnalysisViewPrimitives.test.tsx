import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MetricDefinitions } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";

describe("MetricDefinitions", () => {
  it("explains how to use each metric instead of narrating its display format", async () => {
    const user = userEvent.setup();
    const response = makeSeriesAnalysisAggregate();
    response.metricDefinitions.push({
      label: "平均物件収益",
      metricId: "revenue.average",
      preferredDirection: "higher",
      unit: "man_yen",
    });
    render(<MetricDefinitions response={response} />);

    await user.click(screen.getByRole("button", { name: "指標の読み方" }));

    expect(screen.getByText(/平均に隠れた波を確認します/u)).toBeInTheDocument();
    expect(screen.getByText(/収益額の大きさだけで勝因を決めません/u)).toBeInTheDocument();
    expect(screen.queryByText(/割合で表示します/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/金額は.*表示します/u)).not.toBeInTheDocument();
  });
});
