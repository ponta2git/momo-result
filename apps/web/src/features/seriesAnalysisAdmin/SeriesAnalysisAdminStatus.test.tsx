import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecentJobs } from "@/features/seriesAnalysisAdmin/SeriesAnalysisAdminStatus";
import { makeSeriesAnalysisAdminOverview } from "@/test/msw/seriesAnalysisFixtures";

describe("SeriesAnalysisAdminStatus", () => {
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
