import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { useSeriesAnalysisDisplay } from "@/features/seriesComparison/page/useSeriesAnalysisDisplay";
import { invalidateAfterMatchUpdated } from "@/shared/api/cacheInvalidation";
import { seriesAnalysisKeys, seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import type {
  SeriesAnalysisOutlookSummary,
  SeriesComparisonAggregate,
} from "@/shared/api/seriesAnalysis";
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
  makeSeriesAnalysisScopeStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { makeSeriesAnalysisOutlookSummary } from "@/test/msw/seriesAnalysisOutlookFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

// Query lifecycle is the oracle here; prepare the large generated validator before timed UI waits.
beforeAll(() =>
  Promise.all([
    import("@/shared/api/generatedContracts/series-analysis-envelope-validators.generated"),
    decodeSeriesAnalysisArtifact("aggregateV5", makeSeriesAnalysisAggregate()),
    decodeSeriesAnalysisArtifact("matchContext", makeSeriesAnalysisMatchContext()),
  ]),
);

describe("useSeriesAnalysisDisplay", () => {
  it("holds a fully loaded replacement outlook during a gesture and adopts its complete summary on release", async () => {
    setDevUser();
    const queryClient = createTestQueryClient();
    const initial = await makeSeriesAnalysisOutlookSummary();
    const nextArtifact = {
      ...initial.artifact,
      artifactId: "artifact-after-deletion",
      inputRevision: "13",
      publishedAt: "2026-08-10T01:02:03.000Z",
    };
    // A correction leaves one legal four-player game, changing count, quality and all references.
    const period = {
      startMatchId: "remaining-match",
      endMatchId: "remaining-match",
      startSequence: 1,
      endSequence: 1,
      startedAt: "2026-01-01T00:00:00.000000Z",
      endedAt: "2026-01-01T00:00:00.000000Z",
    };
    const recentPlayers = initial.recent.players.map((player, index) => ({
      ...player,
      rankCounts: [0, 1, 2, 3].map((rank) => (rank === index ? 1 : 0)) as [
        number,
        number,
        number,
        number,
      ],
      rankSum: index + 1,
      averageRank: index + 1,
    }));
    const jointRanks = initial.recent.jointRanks.map((pair) => {
      const first = recentPlayers.findIndex((player) => player.memberId === pair.memberAId);
      const second = recentPlayers.findIndex((player) => player.memberId === pair.memberBId);
      return {
        ...pair,
        rankCounts: [0, 1, 2, 3].map((a) =>
          [0, 1, 2, 3].map((b) => (a === first && b === second ? 1 : 0)),
        ) as typeof pair.rankCounts,
      };
    });
    const next = await makeSeriesAnalysisOutlookSummary({
      ...initial,
      artifact: nextArtifact,
      period,
      qualityStatus: "reference",
      scope: { ...initial.scope, matchCount: 1 },
      source: { ...initial.source, titleMatchCount: 1 },
      players: initial.players.map((player, index) => ({
        ...player,
        rankSum: index + 1,
        averageRank: index + 1,
      })),
      recent: {
        ...initial.recent,
        period,
        matchCount: 1,
        qualityStatus: "reference",
        players: recentPlayers,
        jointRanks,
      },
    });
    let publishedArtifact = initial.artifact;
    const summaryGate = createDeferred();
    const requestedArtifacts: Array<string | null> = [];
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json(makeSeriesAnalysisStatus({ currentArtifact: publishedArtifact })),
      ),
      http.get("/api/analytics/series-comparison/v1/outlook-summary", async ({ request }) => {
        const artifactId = new URL(request.url).searchParams.get("artifactId");
        requestedArtifacts.push(artifactId);
        if (artifactId === nextArtifact.artifactId) {
          await summaryGate.promise;
          return HttpResponse.json(next);
        }
        return HttpResponse.json(initial);
      }),
    );
    const state: SeriesAnalysisSelection = {
      gameTitleId: initial.artifact.gameTitleId,
      view: "outlook",
    };
    const displayed: Array<{ held: boolean; summary: SeriesAnalysisOutlookSummary }> = [];
    const { result, rerender } = renderHook(
      (held: boolean) => {
        const resource = useSeriesAnalysisDisplay({
          activeView: "outlook",
          state,
          deferredState: state,
          deferOutlookAdoption: held,
        });
        const bundle = resource.resource.bundle;
        useEffect(() => {
          if (bundle?.kind === "outlook") displayed.push({ held, summary: bundle.outlook });
        }, [bundle, held]);
        return resource;
      },
      {
        initialProps: false,
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.resource.data).toEqual(initial));
    rerender(true);
    publishedArtifact = nextArtifact;
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(requestedArtifacts).toEqual([initial.artifact.artifactId, nextArtifact.artifactId]),
    );
    expect(result.current.resource.data).toEqual(initial);
    expect(result.current.resource.loading).toBe(false);
    expect(result.current.resource.scopeState).toBe("available");
    await act(async () => summaryGate.resolve());
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          seriesAnalysisKeys.outlookSummary({
            gameTitleId: state.gameTitleId,
            artifactId: nextArtifact.artifactId,
          }),
        ),
      ).toEqual(next),
    );
    await waitFor(() => expect(result.current.candidateArtifactId).toBe(nextArtifact.artifactId));
    expect(result.current.resource.data).toEqual(initial);
    expect(result.current.resource.shielded).toBe(false);
    rerender(false);
    await waitFor(() => expect(result.current.resource.data).toEqual(next));
    expect(requestedArtifacts).toEqual([initial.artifact.artifactId, nextArtifact.artifactId]);
    for (const entry of displayed) {
      if (entry.held || entry.summary.artifact.artifactId === initial.artifact.artifactId)
        expect(entry.summary).toEqual(initial);
      else expect(entry.summary).toEqual(next);
    }
  });

  it("keeps the displayed scope and inputs available until a gesture ends after the last game is deleted", async () => {
    setDevUser();
    const queryClient = createTestQueryClient();
    const initial = await makeSeriesAnalysisOutlookSummary();
    const nextArtifact = {
      ...initial.artifact,
      artifactId: "artifact-with-no-games",
      inputRevision: "13",
    };
    const empty = await makeSeriesAnalysisOutlookSummary({ artifact: nextArtifact }, true);
    let publishedArtifact = initial.artifact;
    const summaryGate = createDeferred();
    let replacementRequested = false;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json(makeSeriesAnalysisStatus({ currentArtifact: publishedArtifact })),
      ),
      http.get("/api/analytics/series-comparison/v2/scope-status", ({ request }) => {
        const artifactId = new URL(request.url).searchParams.get("artifactId");
        const isEmpty = artifactId === nextArtifact.artifactId;
        return HttpResponse.json(
          makeSeriesAnalysisScopeStatus({
            artifactId,
            state: isEmpty ? "empty" : "available",
            currentHasMatches: !isEmpty,
            publishedHasMatches: !isEmpty,
          }),
        );
      }),
      http.get("/api/analytics/series-comparison/v1/outlook-summary", async ({ request }) => {
        if (new URL(request.url).searchParams.get("artifactId") === nextArtifact.artifactId) {
          replacementRequested = true;
          await summaryGate.promise;
          return HttpResponse.json(empty);
        }
        return HttpResponse.json(initial);
      }),
    );
    const state: SeriesAnalysisSelection = {
      gameTitleId: initial.artifact.gameTitleId,
      view: "outlook",
    };
    const { result, rerender } = renderHook(
      (held: boolean) =>
        useSeriesAnalysisDisplay({
          activeView: "outlook",
          state,
          deferredState: state,
          deferOutlookAdoption: held,
        }),
      {
        initialProps: false,
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.resource.data).toEqual(initial));
    rerender(true);
    publishedArtifact = nextArtifact;
    act(() => result.current.refresh());
    await waitFor(() => expect(replacementRequested).toBe(true));
    expect(result.current.resource.scopeState).toBe("available");
    expect(result.current.resource.data).toEqual(initial);
    expect(result.current.resource.loading).toBe(false);
    expect(result.current.resource.shielded).toBe(false);
    await act(async () => summaryGate.resolve());
    await waitFor(() => expect(result.current.candidateArtifactId).toBe(nextArtifact.artifactId));
    expect(result.current.resource.scopeState).toBe("available");
    expect(result.current.resource.data).toEqual(initial);
    rerender(false);
    await waitFor(() => expect(result.current.resource.data).toEqual(empty));
    expect(result.current.resource.scopeState).toBe("empty");
  });

  it("does not retain another selected match or view when a replacement artifact fails", async () => {
    const queryClient = createTestQueryClient();
    const nextArtifact = {
      ...analysisArtifact,
      artifactId: "artifact-unavailable",
      inputRevision: "13",
    };
    let nextPublication = false;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json(
          makeSeriesAnalysisStatus({
            currentArtifact: nextPublication ? nextArtifact : analysisArtifact,
          }),
        ),
      ),
      http.get("/api/analytics/series-comparison/v5/aggregate", ({ request }) =>
        new URL(request.url).searchParams.get("artifactId") === nextArtifact.artifactId
          ? HttpResponse.json({ title: "Unavailable" }, { status: 503 })
          : HttpResponse.json(makeSeriesAnalysisAggregate()),
      ),
      http.get("/api/analytics/series-comparison/v3/match-context", ({ request }) => {
        const params = new URL(request.url).searchParams;
        return HttpResponse.json({
          ...makeSeriesAnalysisMatchContext(),
          artifact:
            params.get("artifactId") === nextArtifact.artifactId ? nextArtifact : analysisArtifact,
          matchId: params.get("matchId"),
        });
      }),
    );
    const initialState: SeriesAnalysisSelection = {
      gameTitleId: analysisArtifact.gameTitleId,
      focusMatchId: "match-12",
      view: "overview",
    };
    const { result, rerender } = renderHook(
      (state: SeriesAnalysisSelection) =>
        useSeriesAnalysisDisplay({
          activeView: state.view ?? "overview",
          deferredState: state,
          state,
        }),
      {
        initialProps: initialState,
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.focus.data?.matchId).toBe("match-12"));
    nextPublication = true;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.resource.hasError).toBe(true));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(result.current.focus.data?.matchId).toBe("match-12");

    rerender({ ...initialState, focusMatchId: "match-13", view: "flow" });
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          seriesAnalysisKeys.matchContext({
            artifactId: nextArtifact.artifactId,
            gameTitleId: analysisArtifact.gameTitleId,
            matchId: "match-13",
          }),
        ),
      ).toMatchObject({ kind: "available" }),
    );
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(result.current.resource.data?.artifact.artifactId).toBe(analysisArtifact.artifactId);
    expect(result.current.resource.bundle?.view).toBe("flow");
    expect(result.current.focus.data).toBeUndefined();
    expect(result.current.focus.hasError).toBe(true);
    expect(result.current.resource.shielded).toBe(false);
  });

  it.each([
    [404, "NOT_FOUND"],
    [410, "ANALYSIS_ARTIFACT_EXPIRED"],
  ] as const)(
    "removes retained context after a definitive %s while the next aggregate is unavailable",
    async (status, code) => {
      setDevUser();
      const queryClient = createTestQueryClient();
      const aggregateGate = createDeferred();
      const contextGate = createDeferred();
      const nextArtifact = {
        ...analysisArtifact,
        artifactId: "artifact-next",
        inputRevision: "13",
      };
      let nextPublication = false;
      let aggregateAvailable = false;
      let requestedNextMatch = false;
      server.use(
        http.get("/api/analytics/series-comparison/v2/status", () =>
          HttpResponse.json(
            makeSeriesAnalysisStatus({
              currentArtifact: nextPublication ? nextArtifact : analysisArtifact,
            }),
          ),
        ),
        http.get("/api/analytics/series-comparison/v5/aggregate", async ({ request }) => {
          if (new URL(request.url).searchParams.get("artifactId") !== nextArtifact.artifactId)
            return HttpResponse.json(makeSeriesAnalysisAggregate());
          await aggregateGate.promise;
          return aggregateAvailable
            ? HttpResponse.json(makeSeriesAnalysisAggregate(nextArtifact))
            : HttpResponse.json({ title: "Unavailable" }, { status: 503 });
        }),
        http.get("/api/analytics/series-comparison/v3/match-context", async ({ request }) => {
          const params = new URL(request.url).searchParams;
          if (params.get("artifactId") !== nextArtifact.artifactId)
            return HttpResponse.json(makeSeriesAnalysisMatchContext());
          if (params.get("matchId") === "match-12")
            return HttpResponse.json(
              { type: "about:blank", title: "Unavailable", detail: "Unavailable", status, code },
              { status },
            );
          requestedNextMatch = true;
          await contextGate.promise;
          return HttpResponse.json({
            ...makeSeriesAnalysisMatchContext(),
            artifact: nextArtifact,
            matchId: "match-13",
          });
        }),
      );
      const initialState: SeriesAnalysisSelection = {
        gameTitleId: analysisArtifact.gameTitleId,
        focusMatchId: "match-12",
        view: "overview",
      };
      const { result, rerender } = renderHook(
        (state: SeriesAnalysisSelection) =>
          useSeriesAnalysisDisplay({ activeView: "overview", deferredState: state, state }),
        {
          initialProps: initialState,
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          ),
        },
      );
      await waitFor(() => expect(result.current.focus.data?.matchId).toBe("match-12"));
      nextPublication = true;
      act(() => result.current.refresh());
      await waitFor(() =>
        expect(
          queryClient.getQueryData(
            seriesAnalysisKeys.matchContext({
              artifactId: nextArtifact.artifactId,
              gameTitleId: analysisArtifact.gameTitleId,
              mapMasterId: undefined,
              seasonMasterId: undefined,
              matchId: "match-12",
            }),
          ),
        ).toMatchObject({ kind: "unavailable" }),
      );
      await waitFor(() => expect(result.current.focus.data).toBeUndefined());
      expect(result.current.resource.data?.artifact.artifactId).toBe(analysisArtifact.artifactId);
      expect(result.current.resource.bundle?.matchContext).toBeUndefined();
      expect(result.current.candidateArtifactId).toBeUndefined();

      await act(async () => aggregateGate.resolve());
      await waitFor(() => expect(result.current.resource.hasError).toBe(true));
      expect(result.current.resource.bundle?.matchContext).toBeUndefined();
      rerender({ ...initialState, focusMatchId: "match-13" });
      await waitFor(() => expect(requestedNextMatch).toBe(true));
      expect(result.current.focus.data).toBeUndefined();
      expect(result.current.resource.bundle?.matchContext).toBeUndefined();

      aggregateAvailable = true;
      act(() => result.current.refresh());
      await act(async () => contextGate.resolve());
      await waitFor(() => {
        expect(result.current.resource.data?.artifact.artifactId).toBe(nextArtifact.artifactId);
        expect(result.current.focus.data?.matchId).toBe("match-13");
      });
    },
  );

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
      seriesPlayerRadarKeys.scopeStatus(query),
      makeSeriesAnalysisScopeStatus(),
    );
    queryClient.setQueryData(
      seriesPlayerRadarKeys.scopeStatus({ ...query, seasonMasterId: "season_current" }),
      makeSeriesAnalysisScopeStatus({ seasonMasterId: "season_current", seasonName: "今シーズン" }),
    );
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
      const [state, setState] = useState<SeriesAnalysisSelection>({
        gameTitleId: query.gameTitleId,
      });
      const analysis = useSeriesAnalysisDisplay({
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
        http.get("/api/analytics/series-comparison/v5/aggregate", ({ request }) => {
          const id = new URL(request.url).searchParams.get("artifactId") ?? "";
          aggregates.push(id);
          return HttpResponse.json(
            makeSeriesAnalysisAggregate(
              id === nextArtifact.artifactId ? nextArtifact : analysisArtifact,
            ),
          );
        }),
        http.get("/api/analytics/series-comparison/v3/match-context", ({ request }) => {
          const id = new URL(request.url).searchParams.get("artifactId") ?? "";
          contexts.push(id);
          return HttpResponse.json({
            ...makeSeriesAnalysisMatchContext(),
            artifact: id === nextArtifact.artifactId ? nextArtifact : analysisArtifact,
          });
        }),
      );
      const state: SeriesAnalysisSelection = {
        gameTitleId: analysisArtifact.gameTitleId,
        focusMatchId: "match-12",
        view: "overview",
      };
      const { result } = renderHook(
        () => useSeriesAnalysisDisplay({ activeView: "overview", deferredState: state, state }),
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
        http.get("/api/analytics/series-comparison/v5/aggregate", ({ request }) => {
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
      const initialState: SeriesAnalysisSelection = { gameTitleId: analysisArtifact.gameTitleId };
      const { result, rerender, unmount } = renderHook(
        (state: SeriesAnalysisSelection) =>
          useSeriesAnalysisDisplay({ activeView: "overview", deferredState: state, state }),
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
      http.get("/api/analytics/series-comparison/v5/aggregate", () => {
        aggregateReads += 1;
        return HttpResponse.json(makeSeriesAnalysisAggregate());
      }),
      http.get("/api/analytics/series-comparison/v3/match-context", () => {
        contextReads += 1;
        return HttpResponse.json(
          corrected
            ? makeSeriesAnalysisExcludedMatchContext("match_changed_since_artifact", "match-12")
            : makeSeriesAnalysisMatchContext(),
        );
      }),
    );
    const state: SeriesAnalysisSelection = {
      gameTitleId: analysisArtifact.gameTitleId,
      focusMatchId: "match-12",
      view: "overview",
    };
    const { result } = renderHook(
      () => useSeriesAnalysisDisplay({ activeView: "overview", deferredState: state, state }),
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
        http.get("/api/analytics/series-comparison/v5/aggregate", ({ request }) => {
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
      const initialState: SeriesAnalysisSelection = {
        gameTitleId: analysisArtifact.gameTitleId,
        view: "overview",
      };
      const { result, rerender, unmount } = renderHook(
        (state: SeriesAnalysisSelection) =>
          useSeriesAnalysisDisplay({ activeView: "overview", deferredState: state, state }),
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
