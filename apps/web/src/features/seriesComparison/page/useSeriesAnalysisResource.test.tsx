import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type { SeriesAnalysisUrlState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { useSeriesAnalysisResource } from "@/features/seriesComparison/page/useSeriesAnalysisResource";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  analysisArtifact,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

describe("useSeriesAnalysisResource", () => {
  it.each(["scope change", "unmount"] as const)(
    "does not continue expiry recovery after %s",
    async (action) => {
      setDevUser();
      const queryClient = createTestQueryClient();
      const recoveryGate = createDeferred();
      let recoveryStarted = false;
      const aggregateScopes: Array<string | null> = [];
      server.use(
        http.get("/api/analytics/series-comparison/v2/status", async () => {
          if (aggregateScopes.includes(null)) {
            recoveryStarted = true;
            await recoveryGate.promise;
          }
          return HttpResponse.json(makeSeriesAnalysisStatus());
        }),
        http.get("/api/analytics/series-comparison/v2/aggregate", ({ request }) => {
          const seasonMasterId = new URL(request.url).searchParams.get("seasonMasterId");
          aggregateScopes.push(seasonMasterId);
          if (!seasonMasterId) {
            return HttpResponse.json(
              {
                code: "ANALYSIS_ARTIFACT_EXPIRED",
                detail: "The requested artifact is no longer retained.",
                status: 410,
                title: "Artifact expired",
                type: "about:blank",
              },
              { status: 410 },
            );
          }
          const aggregate = makeSeriesAnalysisAggregate();
          return HttpResponse.json({
            ...aggregate,
            scope: { ...aggregate.scope, kind: "season", seasonMasterId },
          });
        }),
      );
      const initialState: SeriesAnalysisUrlState = {
        gameTitleId: analysisArtifact.gameTitleId,
        view: "overview",
      };
      const { result, rerender, unmount } = renderHook(
        (state: SeriesAnalysisUrlState) =>
          useSeriesAnalysisResource({ activeView: "overview", deferredState: state, state }),
        {
          initialProps: initialState,
          reactStrictMode: true,
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          ),
        },
      );

      await waitFor(() => expect(recoveryStarted).toBe(true));
      if (action === "scope change") {
        rerender({ ...initialState, seasonMasterId: "season_current" });
        await waitFor(() => expect(result.current.resource.data?.scope.kind).toBe("season"));
        expect(result.current.status.refreshing).toBe(true);
      } else {
        unmount();
      }

      await act(async () => recoveryGate.resolve());
      await waitFor(() => {
        if (action === "scope change") expect(result.current.status.refreshing).toBe(false);
        expect(queryClient.isFetching()).toBe(0);
      });
      if (action === "scope change") {
        expect(result.current.resource.data?.scope).toMatchObject({
          kind: "season",
          seasonMasterId: "season_current",
        });
        expect(aggregateScopes).toEqual([null, "season_current"]);
      } else {
        expect(aggregateScopes).toEqual([null]);
      }
    },
  );
});
