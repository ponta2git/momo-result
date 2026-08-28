import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  RecentJobs,
  SelectedTitleStatus,
} from "@/features/seriesAnalysisAdmin/SeriesAnalysisAdminStatus";
import { makeSeriesAnalysisAdminOverview } from "@/test/msw/seriesAnalysisFixtures";

describe("SeriesAnalysisAdminStatus", () => {
  it("announces the selected title's dynamic calculation status through the shared badge", () => {
    const overview = makeSeriesAnalysisAdminOverview();
    const selected = overview.selectedTitle;
    if (!selected?.status.calculation) throw new Error("Expected a selected calculation fixture");

    render(
      <SelectedTitleStatus
        selected={{
          ...selected,
          status: {
            ...selected.status,
            calculation: { ...selected.status.calculation, status: "running" },
          },
        }}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("計算中");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("does not announce historical job statuses as live updates", () => {
    const overview = makeSeriesAnalysisAdminOverview();

    render(<RecentJobs jobs={overview.recentJobs} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("成功")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "全作品の直近3件の実行履歴" })).toBeInTheDocument();
  });

  it("uses the embedded empty-state contract when no recent jobs exist", () => {
    render(<RecentJobs jobs={[]} />);

    expect(
      screen.getByRole("heading", { level: 3, name: "実行履歴はありません" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
