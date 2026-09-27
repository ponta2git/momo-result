import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { SeriesComparisonPage } from "@/features/seriesComparison/page/SeriesComparisonPage";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

// This suite observes refresh after an initial result; cold route loading is covered by app routing.
beforeAll(() =>
  Promise.all([
    import("@/features/seriesComparison/page/SeriesAnalysisFlowView"),
    decodeSeriesAnalysisArtifact("aggregateV4", makeSeriesAnalysisAggregate()),
  ]),
);

describe("SeriesComparisonPage manual refresh", () => {
  it("keeps same-artifact content and its focused disclosure usable during refresh", async () => {
    const user = userEvent.setup();
    const aggregateGate = createDeferred();
    let aggregateRequests = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v4/aggregate", async () => {
        aggregateRequests += 1;
        if (aggregateRequests > 1) await aggregateGate.promise;
        return HttpResponse.json(makeSeriesAnalysisAggregate());
      }),
    );
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/analytics/series?view=flow"]}>
          <SeriesComparisonPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const disclosure = await screen.findByRole("button", {
      name: "4人の累積入賞率の推移の数値を表で見る",
    });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    await user.click(screen.getByRole("button", { name: "表示を更新" }));
    await waitFor(() => expect(aggregateRequests).toBe(2));
    expect(screen.getByRole("button", { name: "表示を更新中" })).toBeDisabled();
    expect(disclosure.closest("[inert]")).toBeNull();
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(disclosure).toHaveFocus();
    const values = screen.getByRole("table", { name: "4人の累積入賞率の推移の数値" });
    expect(within(values).getByRole("row", { name: "第12戦 75%" })).toBeInTheDocument();

    aggregateGate.resolve();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(disclosure).toHaveFocus();
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
  });

  it("updates the calculation status and re-enables refresh after the explicit request settles", async () => {
    const user = userEvent.setup();
    const nextStatusResponse = createDeferred();
    let statusRequests = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", async () => {
        statusRequests += 1;
        if (statusRequests === 1) return HttpResponse.json(makeSeriesAnalysisStatus());
        await nextStatusResponse.promise;
        return HttpResponse.json(
          makeSeriesAnalysisStatus({
            artifactFreshness: "stale",
            calculation: {
              finishedAt: null,
              requestedAt: "2026-08-09T02:00:00.000Z",
              startedAt: "2026-08-09T02:00:01.000Z",
              status: "running",
              trigger: "match_mutation",
            },
          }),
        );
      }),
    );
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/analytics/series?view=flow"]}>
          <SeriesComparisonPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "累積入賞率" })).toBeInTheDocument();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(statusRequests).toBe(1);

    await user.click(screen.getByRole("button", { name: "表示を更新" }));
    expect(await screen.findByRole("button", { name: "表示を更新中" })).toBeDisabled();
    expect(statusRequests).toBe(2);

    nextStatusResponse.resolve();

    expect(await screen.findByText("新しい戦績データを計算中です")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "累積入賞率" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "4人の累積入賞率の推移の数値を表で見る" }));
    expect(
      within(screen.getByRole("table", { name: "4人の累積入賞率の推移の数値" })).getByRole("row", {
        name: "第12戦 75%",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "表示を更新" })).toBeEnabled();
    expect(statusRequests).toBe(2);
  });
});
