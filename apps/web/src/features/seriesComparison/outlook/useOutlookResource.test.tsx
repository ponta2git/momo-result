import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { useOutlookResource } from "@/features/seriesComparison/outlook/useOutlookResource";
import type { ProblemDetails } from "@/shared/api/problemDetails";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisOutlookSummary,
  makeSeriesAnalysisOutlookWindow,
} from "@/test/msw/seriesAnalysisOutlookFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

describe("useOutlookResource", () => {
  it("preserves an expired resource after a failed status read and permits explicit retry", async () => {
    setDevUser();
    const summary = await makeSeriesAnalysisOutlookSummary();
    const available = await makeSeriesAnalysisOutlookWindow(1);
    const queryClient = createTestQueryClient();
    let windowRequests = 0;
    let availableOnRetry = false;
    server.use(
      http.get("/api/analytics/series-comparison/v1/outlook-window", () => {
        windowRequests += 1;
        return availableOnRetry
          ? HttpResponse.json(available)
          : HttpResponse.json(
              {
                code: "ANALYSIS_ARTIFACT_EXPIRED",
                status: 410,
                title: "Artifact expired",
                detail: "The requested artifact is no longer retained.",
                type: "about:blank",
              } satisfies ProblemDetails,
              { status: 410 },
            );
      }),
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json({ title: "Unavailable" }, { status: 503 }),
      ),
    );
    const { result } = renderHook(() => useOutlookResource(summary, available.memberId, 1, false), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryState(seriesAnalysisKeys.status(summary.artifact.gameTitleId)),
      ).toMatchObject({ status: "error", fetchStatus: "idle" }),
    );
    expect(result.current.window.isError).toBe(true);
    expect(result.current.window.error).toMatchObject({
      code: "ANALYSIS_ARTIFACT_EXPIRED",
      status: 410,
    });
    expect(result.current.window.data).toBeUndefined();
    expect(windowRequests).toBe(1);

    availableOnRetry = true;
    await act(async () => {
      await result.current.window.refetch();
    });
    await waitFor(() => expect(result.current.window.isSuccess).toBe(true));
    expect(result.current.window.data).toEqual(available);
    expect(result.current.window.error).toBeNull();
  });
});
