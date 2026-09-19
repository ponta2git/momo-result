import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Suspense, useState } from "react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import type { SeriesAnalysisUrlState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { useSeriesAnalysisResource } from "@/features/seriesComparison/page/useSeriesAnalysisResource";
import { invalidateAfterMatchUpdated } from "@/shared/api/cacheInvalidation";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  analysisArtifact,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisExcludedMatchContext,
  makeSeriesAnalysisMatchContext,
  makeSeriesAnalysisStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

// Query lifecycle is the oracle here; prepare the large generated validator before timed UI waits.
beforeAll(() => decodeSeriesAnalysisArtifact("aggregateV3", makeSeriesAnalysisAggregate()));

describe("useSeriesAnalysisResource", () => {
  it("keeps the previous analysis visible and shielded until deferred rendering is ready", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const aggregate = makeSeriesAnalysisAggregate();
    const query = {
      artifactId: analysisArtifact.artifactId,
      gameTitleId: analysisArtifact.gameTitleId,
    };
    const season: SeriesComparisonAggregate = {
      ...aggregate,
      scope: { ...aggregate.scope, kind: "season", seasonMasterId: "season_current" },
    };
    queryClient.setQueryDefaults(seriesAnalysisKeys.status(query.gameTitleId), {
      staleTime: Infinity,
    });
    queryClient.setQueryData(
      seriesAnalysisKeys.status(query.gameTitleId),
      makeSeriesAnalysisStatus(),
    );
    queryClient.setQueryData(seriesAnalysisKeys.aggregate(query), aggregate);
    queryClient.setQueryData(
      seriesAnalysisKeys.aggregate({ ...query, seasonMasterId: "season_current" }),
      season,
    );
    const gate = createDeferred();
    let chartReady = false;
    function Chart({ kind }: { kind: string | undefined }) {
      if (kind === "season" && !chartReady) throw gate.promise;
      return <p>表示範囲: {kind}</p>;
    }
    function Harness() {
      const [state, setState] = useState<SeriesAnalysisUrlState>({
        gameTitleId: query.gameTitleId,
      });
      const analysis = useSeriesAnalysisResource({
        activeView: "overview",
        state,
        deferredState: state,
      });
      return (
        <>
          <button
            type="button"
            onClick={() => setState({ ...state, seasonMasterId: "season_current" })}
          >
            シーズンを選択
          </button>
          <output aria-label="選択中の範囲">{state.seasonMasterId ?? "overall"}</output>
          <output aria-label="操作制限">{String(analysis.resource.shielded)}</output>
          <Suspense fallback={<p>チャート準備中</p>}>
            <Chart kind={analysis.resource.data?.scope.kind} />
          </Suspense>
        </>
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
    expect(screen.getByText("表示範囲: overall")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "シーズンを選択" }));
    expect(screen.getByLabelText("選択中の範囲")).toHaveTextContent("season_current");
    expect(screen.getByText("表示範囲: overall")).toBeVisible();
    expect(screen.getByLabelText("操作制限")).toHaveTextContent("true");
    expect(screen.queryByText("チャート準備中")).not.toBeInTheDocument();

    await act(async () => {
      chartReady = true;
      gate.resolve();
    });
    expect(screen.getByText("表示範囲: season")).toBeVisible();
    expect(screen.getByLabelText("操作制限")).toHaveTextContent("false");
  });

  it.each(["same", "new"] as const)(
    "refreshes the %s publication without first reloading obsolete resources",
    async (publication) => {
      setDevUser();
      const queryClient = createTestQueryClient();
      const statusGate = createDeferred();
      const nextArtifact =
        publication === "new"
          ? { ...analysisArtifact, artifactId: "artifact-new", inputRevision: "13" }
          : analysisArtifact;
      let statusReads = 0;
      const aggregates: string[] = [];
      const contexts: string[] = [];
      server.use(
        http.get("/api/analytics/series-comparison/v2/status", async () => {
          statusReads += 1;
          if (statusReads > 1) await statusGate.promise;
          return HttpResponse.json(
            makeSeriesAnalysisStatus({
              currentArtifact: statusReads > 1 ? nextArtifact : analysisArtifact,
            }),
          );
        }),
        http.get("/api/analytics/series-comparison/v3/aggregate", ({ request }) => {
          const id = new URL(request.url).searchParams.get("artifactId") ?? "";
          aggregates.push(id);
          return HttpResponse.json(
            makeSeriesAnalysisAggregate(
              id === nextArtifact.artifactId ? nextArtifact : analysisArtifact,
            ),
          );
        }),
        http.get("/api/analytics/series-comparison/v2/match-context", ({ request }) => {
          const id = new URL(request.url).searchParams.get("artifactId") ?? "";
          contexts.push(id);
          return HttpResponse.json({
            ...makeSeriesAnalysisMatchContext(),
            artifact: id === nextArtifact.artifactId ? nextArtifact : analysisArtifact,
          });
        }),
      );
      const state: SeriesAnalysisUrlState = {
        gameTitleId: analysisArtifact.gameTitleId,
        focusMatchId: "match-12",
        view: "overview",
      };
      const { result } = renderHook(
        () => useSeriesAnalysisResource({ activeView: "overview", deferredState: state, state }),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          ),
        },
      );
      await waitFor(() => expect(result.current.focus.data?.matchId).toBe("match-12"));
      act(() => result.current.refresh());
      await waitFor(() => expect(statusReads).toBe(2));
      expect(aggregates).toEqual([analysisArtifact.artifactId]);
      expect(contexts).toEqual([analysisArtifact.artifactId]);
      await act(async () => statusGate.resolve());
      await waitFor(() => {
        expect(aggregates).toEqual([analysisArtifact.artifactId, nextArtifact.artifactId]);
        expect(contexts).toEqual([analysisArtifact.artifactId, nextArtifact.artifactId]);
        expect(queryClient.isFetching()).toBe(0);
        expect(result.current.resource.data?.artifact.artifactId).toBe(nextArtifact.artifactId);
      });
    },
  );

  it.each(["scope change", "unmount"] as const)(
    "does not retarget a manual refresh after %s while status is pending",
    async (action) => {
      setDevUser();
      const queryClient = createTestQueryClient();
      const statusGate = createDeferred();
      let statusReads = 0;
      const scopes: Array<string | null> = [];
      server.use(
        http.get("/api/analytics/series-comparison/v2/status", async () => {
          statusReads += 1;
          if (statusReads > 1) await statusGate.promise;
          return HttpResponse.json(makeSeriesAnalysisStatus());
        }),
        http.get("/api/analytics/series-comparison/v3/aggregate", ({ request }) => {
          const seasonMasterId = new URL(request.url).searchParams.get("seasonMasterId");
          scopes.push(seasonMasterId);
          const aggregate = makeSeriesAnalysisAggregate();
          return HttpResponse.json(
            seasonMasterId
              ? { ...aggregate, scope: { ...aggregate.scope, kind: "season", seasonMasterId } }
              : aggregate,
          );
        }),
      );
      const initialState: SeriesAnalysisUrlState = { gameTitleId: analysisArtifact.gameTitleId };
      const { result, rerender, unmount } = renderHook(
        (state: SeriesAnalysisUrlState) =>
          useSeriesAnalysisResource({ activeView: "overview", deferredState: state, state }),
        {
          initialProps: initialState,
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          ),
        },
      );
      await waitFor(() => expect(result.current.resource.data?.scope.kind).toBe("overall"));
      act(() => result.current.refresh());
      await waitFor(() => expect(statusReads).toBe(2));
      if (action === "scope change") {
        rerender({ ...initialState, seasonMasterId: "season_current" });
        await waitFor(() => expect(result.current.resource.data?.scope.kind).toBe("season"));
      } else unmount();
      await act(async () => statusGate.resolve());
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      expect(scopes).toEqual(action === "scope change" ? [null, "season_current"] : [null]);
    },
  );

  it("rechecks live match inclusion after correction while keeping the same calculation cached", async () => {
    setDevUser();
    const queryClient = createTestQueryClient();
    let corrected = false;
    let aggregateReads = 0;
    let contextReads = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v3/aggregate", () => {
        aggregateReads += 1;
        return HttpResponse.json(makeSeriesAnalysisAggregate());
      }),
      http.get("/api/analytics/series-comparison/v2/match-context", () => {
        contextReads += 1;
        return HttpResponse.json(
          corrected
            ? makeSeriesAnalysisExcludedMatchContext("match_changed_since_artifact", "match-12")
            : makeSeriesAnalysisMatchContext(),
        );
      }),
    );
    const state: SeriesAnalysisUrlState = {
      gameTitleId: analysisArtifact.gameTitleId,
      focusMatchId: "match-12",
      view: "overview",
    };
    const { result } = renderHook(
      () => useSeriesAnalysisResource({ activeView: "overview", deferredState: state, state }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.resolution.kind).toBe("ready"));
    corrected = true;
    await act(async () => invalidateAfterMatchUpdated(queryClient, "match-12"));
    await waitFor(() =>
      expect(result.current.resolution).toEqual({
        kind: "excluded",
        status: "match_changed_since_artifact",
      }),
    );
    expect(contextReads).toBe(2);
    expect(aggregateReads).toBe(1);
  });

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
        http.get("/api/analytics/series-comparison/v3/aggregate", ({ request }) => {
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
