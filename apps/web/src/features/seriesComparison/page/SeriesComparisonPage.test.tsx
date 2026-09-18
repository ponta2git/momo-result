import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { SeriesComparisonPage } from "@/features/seriesComparison/page/SeriesComparisonPage";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
beforeAll(() => decodeSeriesAnalysisArtifact("aggregateV3", makeSeriesAnalysisAggregate()));

describe("SeriesComparisonPage", () => {
  it("keeps purpose tabs, analysis tabs, and the metric guide outside stale results", async () => {
    const user = userEvent.setup();
    const aggregate = makeSeriesAnalysisAggregate();
    const refresh = createDeferred();
    let requests = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v3/aggregate", async () => {
        requests += 1;
        if (requests > 1) await refresh.promise;
        return HttpResponse.json(aggregate);
      }),
    );
    await act(async () => {
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <MemoryRouter
            initialEntries={["/analytics/series?gameTitleId=gt_momotetsu_2&view=overview"]}
          >
            <SeriesComparisonPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    const heading = await screen.findByRole("heading", { name: "順位と基礎比較" });
    await user.click(screen.getByRole("button", { name: "表示を更新" }));
    await waitFor(() => expect(requests).toBe(2));
    await waitFor(() => expect(heading.closest("[inert]")).not.toBeNull());

    const flowTab = screen.getByRole("tab", { name: "推移" });
    const reviewTab = screen.getByRole("tab", { name: "次戦に備える" });
    const metricGuide = screen.getByRole("button", { name: "指標の読み方" });
    expect(flowTab.closest("[inert]")).toBeNull();
    expect(reviewTab.closest("[inert]")).toBeNull();
    expect(metricGuide.closest("[inert]")).toBeNull();
    expect(heading).toBeVisible();

    await user.click(metricGuide);
    expect(await screen.findByRole("dialog", { name: "指標の読み方" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(flowTab);
    expect(flowTab).toHaveAttribute("aria-selected", "true");
    expect(flowTab).toHaveFocus();

    await act(async () => refresh.resolve());
    const flowHeading = await screen.findByRole("heading", { name: "直近順位と累積推移" });
    await waitFor(() => expect(flowHeading.closest("[inert]")).toBeNull());
    expect(flowTab).toHaveFocus();
  });
});
