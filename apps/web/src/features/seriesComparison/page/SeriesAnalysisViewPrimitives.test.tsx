import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MetricDefinitions } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";

describe("MetricDefinitions", () => {
  it("explains how to use each metric instead of narrating its display format", async () => {
    const user = userEvent.setup();
    render(<MetricDefinitions />);

    await user.click(screen.getByRole("button", { name: "指標の読み方" }));

    expect(screen.getByText(/平均に隠れた波を確認します/u)).toBeInTheDocument();
    expect(screen.getByText(/収益額の大きさだけで勝因を決めません/u)).toBeInTheDocument();
    expect(screen.getByText("目的地到着回数（1試合平均）")).toBeInTheDocument();
    expect(screen.getByText(/1試合平均の遭遇回数とは異なります/u)).toBeInTheDocument();
    expect(screen.queryByText(/割合で表示します/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/金額は.*表示します/u)).not.toBeInTheDocument();
  });
});
