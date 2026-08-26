import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  AnalysisTabs,
  PurposeTabs,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";

describe("SeriesComparisonAnalysisNavigation", () => {
  it("moves purpose-tab focus without fetching a new view until explicit activation", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<PurposeTabs activeView="review" onViewChange={onViewChange} />);

    const reviewTab = screen.getByRole("tab", { name: "次戦に備える" });
    const analysisTab = screen.getByRole("tab", { name: "分析する" });
    await user.click(reviewTab);

    await user.keyboard("{ArrowRight}");

    expect(analysisTab).toHaveFocus();
    expect(analysisTab).toHaveAttribute("aria-selected", "false");
    expect(onViewChange).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");

    expect(onViewChange).toHaveBeenCalledWith("overview");
  });

  it("keeps nested analysis tabs manually activated and independent from the purpose tabs", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<AnalysisTabs activeView="overview" onViewChange={onViewChange} />);

    const overviewTab = screen.getByRole("tab", { name: "今の差" });
    const driversTab = screen.getByRole("tab", { name: "勝因候補" });
    await user.click(overviewTab);

    await user.keyboard("{ArrowRight}");

    expect(driversTab).toHaveFocus();
    expect(driversTab).toHaveAttribute("aria-selected", "false");
    expect(onViewChange).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");

    expect(onViewChange).toHaveBeenCalledWith("drivers");
  });
});
