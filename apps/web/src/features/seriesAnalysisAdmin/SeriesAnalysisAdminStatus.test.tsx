import { render, screen, within } from "@testing-library/react";
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
    expect(status).toHaveClass("border-[var(--color-status-info)]/60");
  });

  it("keeps historical job badges static", () => {
    const overview = makeSeriesAnalysisAdminOverview();

    render(<RecentJobs jobs={overview.recentJobs} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("成功").parentElement).toHaveClass("border-[var(--color-success)]/60");
    for (const header of within(screen.getByRole("table")).getAllByRole("columnheader")) {
      expect(header).toHaveClass("bg-[var(--color-surface)]", "border-y");
      expect(header).not.toHaveClass("bg-[var(--color-surface-subtle)]");
    }
  });
});
