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
    const table = screen.getByRole("table", { name: "全作品の直近3件の実行履歴" });
    expect(within(table).getAllByRole("rowheader")).toHaveLength(overview.recentJobs.length);
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header).toHaveClass("bg-[var(--color-surface)]", "border-y");
      expect(header).not.toHaveClass("bg-[var(--color-surface-subtle)]");
      expect(header).toHaveAttribute("scope", "col");
    }
  });

  it("uses the embedded empty-state contract when no recent jobs exist", () => {
    render(<RecentJobs jobs={[]} />);

    const emptyHeading = screen.getByRole("heading", {
      level: 3,
      name: "実行履歴はありません。",
    });
    expect(emptyHeading.closest("section")).toHaveClass("bg-transparent", "py-6");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
