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
    expect(status).not.toHaveAttribute("aria-busy");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("renders ten historical jobs without announcing their statuses as live updates", () => {
    const overview = makeSeriesAnalysisAdminOverview();
    const sourceJob = overview.recentJobs[0];
    if (!sourceJob) throw new Error("Expected a recent job fixture");
    const jobs = Array.from({ length: 10 }, (_, index) => ({
      ...sourceJob,
      jobId: `job-${index + 1}`,
    }));

    render(<RecentJobs jobs={jobs} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getAllByText("成功")).toHaveLength(10);
    const table = screen.getByRole("table", { name: "全作品の直近10件の実行履歴" });
    expect(within(table).getAllByRole("row")).toHaveLength(11);
  });

  it("uses the embedded empty-state contract when no recent jobs exist", () => {
    render(<RecentJobs jobs={[]} />);

    expect(
      screen.getByRole("heading", { level: 3, name: "実行履歴はありません" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("distinguishes final-attempt elapsed time from acceptance-to-start and preserves missing times", () => {
    const job = makeSeriesAnalysisAdminOverview().recentJobs[0];
    if (!job) throw new Error("Expected a recent job fixture");
    render(
      <RecentJobs
        jobs={[
          { ...job, jobId: "finished", elapsedMilliseconds: 19000, queueWaitMilliseconds: 7000 },
          {
            ...job,
            jobId: "queued",
            status: "queued",
            elapsedMilliseconds: null,
            queueWaitMilliseconds: null,
          },
        ]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "最終試行の経過" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "受付から開始まで" })).toBeInTheDocument();
    expect(screen.getByText("19,000 ms")).toBeInTheDocument();
    expect(screen.getByText("7,000 ms")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    const queued = rows.at(-1);
    if (!queued) throw new Error("Expected the queued row");
    expect(within(queued).queryByText("0 ms")).not.toBeInTheDocument();
    expect(within(queued).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
