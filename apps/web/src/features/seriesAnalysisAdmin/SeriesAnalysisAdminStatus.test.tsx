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
    const table = screen.getByRole("table", { name: "全作品の直近10件の実行履歴" });
    const headings = within(table).getAllByRole("columnheader").slice(1);
    const valuesByHeading = (row: HTMLElement) => {
      const values = within(row).getAllByRole("cell");
      return Object.fromEntries(
        headings.map((heading, index) => [heading.textContent, values[index]?.textContent]),
      );
    };
    expect(valuesByHeading(within(table).getByRole("row", { name: /成功/u }))).toMatchObject({
      最終試行の経過: "19,000 ms",
      受付から開始まで: "7,000 ms",
    });
    expect(valuesByHeading(within(table).getByRole("row", { name: /待機中/u }))).toMatchObject({
      最終試行の経過: "—",
      受付から開始まで: "—",
    });
  });
});
