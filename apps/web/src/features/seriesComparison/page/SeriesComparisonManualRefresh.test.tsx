import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeriesAnalysisDisplayBundle } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { SeriesAnalysisContent } from "@/features/seriesComparison/page/SeriesAnalysisContent";
import { SeriesComparisonPage } from "@/features/seriesComparison/page/SeriesComparisonPage";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisMatchContext,
  makeSeriesAnalysisStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

const { flowViewRender } = vi.hoisted(() => ({ flowViewRender: vi.fn() }));

vi.mock("@/features/seriesComparison/page/SeriesAnalysisFlowView", () => ({
  FlowView: (props: unknown) => {
    flowViewRender(props);
    return <div aria-label="artifact由来の可視化" role="region" />;
  },
}));

setupMsw();

describe("SeriesComparisonPage manual refresh", () => {
  beforeEach(() => {
    flowViewRender.mockClear();
  });

  it("uses no automatic interval and updates status only after explicit refresh", async () => {
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

    expect(await screen.findByRole("region", { name: "artifact由来の可視化" })).toBeInTheDocument();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(statusRequests).toBe(1);

    await user.click(screen.getByRole("button", { name: "表示を更新" }));
    expect(await screen.findByRole("button", { name: "表示を更新中" })).toBeDisabled();
    expect(statusRequests).toBe(2);

    nextStatusResponse.resolve();

    expect(await screen.findByText("新しい戦績データを計算中です")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "表示を更新" })).toBeEnabled();
    expect(statusRequests).toBe(2);
  });

  it("renders the artifact subtree when the selected match changes", () => {
    const queryClient = createTestQueryClient();
    const aggregate = makeSeriesAnalysisAggregate();
    const bundle: SeriesAnalysisDisplayBundle = {
      aggregate,
      kind: "analysis",
      matchContext: undefined,
      view: "flow",
    };
    const props = {
      onArtifactExpired: vi.fn(),
      onClearFocusedMatch: vi.fn(),
      onFocusMatch: vi.fn(),
      onViewChange: vi.fn(),
    };
    const view = (nextBundle: SeriesAnalysisDisplayBundle) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SeriesAnalysisContent {...props} bundle={nextBundle} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const rendered = render(view(bundle));
    expect(flowViewRender).toHaveBeenCalledTimes(1);

    rendered.rerender(view({ ...bundle, matchContext: makeSeriesAnalysisMatchContext() }));

    expect(flowViewRender).toHaveBeenCalledTimes(2);
  });
});
