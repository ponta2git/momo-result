import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { appRoutes } from "@/app/router";
import type {
  SeriesAnalysisAdminOverview,
  SeriesAnalysisRecalculationAccepted,
} from "@/shared/api/seriesAnalysis";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisAdminOverview } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function renderAdminPage(initialEntry = "/admin/analysis") {
  const router = createMemoryRouter(appRoutes, { initialEntries: [initialEntry] });
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </QueryClientProvider>,
  );
  return router;
}

describe("SeriesAnalysisAdminPage", () => {
  it("renders the job ledger and sends contract-valid idempotent recalculation requests", async () => {
    setDevUser();
    const titleRequests: Array<{ body: unknown; idempotencyKey: string | null }> = [];
    const allRequests: Array<{ body: unknown; idempotencyKey: string | null }> = [];
    server.use(
      http.get("/api/admin/series-analysis/overview", () => {
        const overview = makeSeriesAnalysisAdminOverview();
        const successfulJob = overview.recentJobs[0];
        if (!successfulJob) throw new Error("job history fixture is required");
        const response = {
          ...overview,
          recentJobs: [
            successfulJob,
            {
              ...successfulJob,
              finishedAt: "2026-08-08T02:02:00.000Z",
              jobId: "job-timeout",
              resultDisposition: "none",
              safeFailureCode: "hard_timeout",
              status: "timed_out",
            },
          ],
        } satisfies SeriesAnalysisAdminOverview;
        return HttpResponse.json(response);
      }),
      http.post("/api/admin/series-analysis/recalculations", async ({ request }) => {
        titleRequests.push({
          body: await request.json(),
          idempotencyKey: request.headers.get("Idempotency-Key"),
        });
        const response = {
          acceptedAt: "2026-08-09T02:00:00.000Z",
          campaign: null,
          requestId: "request-title",
          schemaVersion: 1,
          target: {
            gameTitleId: "gt_momotetsu_2",
            jobId: null,
            requestDisposition: "forced_run_reserved",
          },
          targetCount: 1,
        } satisfies SeriesAnalysisRecalculationAccepted;
        return HttpResponse.json(response, { status: 202 });
      }),
      http.post("/api/admin/series-analysis/recalculations/all", async ({ request }) => {
        allRequests.push({
          body: await request.json(),
          idempotencyKey: request.headers.get("Idempotency-Key"),
        });
        const response = {
          acceptedAt: "2026-08-09T02:00:00.000Z",
          campaign: { campaignId: "campaign-1", status: "expanding" },
          requestId: "request-all",
          schemaVersion: 1,
          target: null,
          targetCount: 1,
        } satisfies SeriesAnalysisRecalculationAccepted;
        return HttpResponse.json(response, { status: 202 });
      }),
    );

    const router = renderAdminPage();
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "戦績分析" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "全体の実行状況" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "直近3件" })).toBeInTheDocument();
    expect(screen.getByText("履歴は45日保持します。", { exact: false })).toBeInTheDocument();
    const history = screen.getByRole("table");
    const historyRows = within(history).getAllByRole("row", { name: /桃太郎電鉄2/u });
    expect(historyRows).toHaveLength(2);
    expect(historyRows[0]).toHaveTextContent("成功");
    expect(historyRows[0]).toHaveTextContent("試合更新");
    expect(historyRows[0]).toHaveTextContent("公開");
    expect(historyRows[1]).toHaveTextContent("タイムアウト");
    expect(historyRows[1]).toHaveTextContent("時間上限");
    await waitFor(() => expect(router.state.location.search).toBe("?gameTitleId=gt_momotetsu_2"));

    await user.click(screen.getByRole("button", { name: "この作品を再計算" }));
    await waitFor(() => expect(titleRequests).toHaveLength(1));
    expect(titleRequests[0]?.body).toEqual({ gameTitleId: "gt_momotetsu_2" });
    expect(titleRequests[0]?.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(await screen.findByText("現在の計算後に再計算します")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全作品を再計算" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "全作品の再計算を予約しますか？",
    });
    expect(dialog).toHaveTextContent("1作品を対象として予約します");
    await user.click(within(dialog).getByRole("button", { name: "全作品を再計算" }));

    await waitFor(() => expect(allRequests).toHaveLength(1));
    expect(allRequests[0]?.body).toEqual({ confirmation: "all_titles" });
    expect(allRequests[0]?.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(allRequests[0]?.idempotencyKey).not.toBe(titleRequests[0]?.idempotencyKey);
    expect(await screen.findByText("1作品の再計算を受け付けました")).toBeInTheDocument();
  });

  it("disables duplicate title requests while a manual run is already reserved", async () => {
    setDevUser();
    server.use(
      http.get("/api/admin/series-analysis/overview", () => {
        const overview = makeSeriesAnalysisAdminOverview();
        if (!overview.selectedTitle) throw new Error("selected title fixture is required");
        return HttpResponse.json({
          ...overview,
          selectedTitle: {
            ...overview.selectedTitle,
            pendingManualRun: {
              oldestRequestedAt: "2026-08-09T02:00:00.000Z",
              requestCount: 1,
            },
          },
        });
      }),
    );

    renderAdminPage("/admin/analysis?gameTitleId=gt_momotetsu_2");

    expect(await screen.findByRole("button", { name: "再計算を予約済み" })).toBeDisabled();
    expect(
      screen.getByText("この作品には未完了の手動再計算予約があります。", { exact: false }),
    ).toBeInTheDocument();
  });

  it("does not load or expose analysis controls to a non-admin user", async () => {
    setDevUser("account_eu");
    let overviewRequests = 0;
    server.use(
      http.get("/api/admin/series-analysis/overview", () => {
        overviewRequests += 1;
        return HttpResponse.json({});
      }),
    );

    renderAdminPage();

    expect(await screen.findByText("管理者権限が必要です")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "この作品を再計算" })).not.toBeInTheDocument();
    expect(overviewRequests).toBe(0);
  });
});
