import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useRadarEditingEvaluation } from "@/features/seriesAnalysisAdmin/useRadarEditingEvaluation";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  analysisArtifact,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisScopeStatus,
  makeSeriesAnalysisStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
beforeEach(() => setDevUser());
beforeAll(() =>
  Promise.all([
    import("@/shared/api/generatedContracts/series-analysis-envelope-validators.generated"),
    import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated"),
    decodeSeriesAnalysisArtifact("aggregateV5", makeSeriesAnalysisAggregate()),
  ]),
);

async function renderEvaluation() {
  const client = createTestQueryClient();
  const hook = renderHook(
    (active) =>
      useRadarEditingEvaluation({
        active,
        gameTitleId: analysisArtifact.gameTitleId,
        currentBasisId: null,
        scope: { seasonMasterId: "", mapMasterId: "" },
        prepared: null,
      }),
    {
      initialProps: true,
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(hook.result.current.evaluation).not.toBeNull());
  return hook;
}

describe("radar editing evaluation refresh", () => {
  it("adopts a new publication without refetching its predecessor", async () => {
    let artifact: SeriesComparisonAggregate["artifact"] = analysisArtifact;
    const requestedScopes: Array<string | null> = [];
    const requestedAggregates: Array<string | null> = [];
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json(makeSeriesAnalysisStatus({ currentArtifact: artifact })),
      ),
      http.get("/api/analytics/series-comparison/v2/scope-status", ({ request }) => {
        const artifactId = new URL(request.url).searchParams.get("artifactId");
        requestedScopes.push(artifactId);
        return HttpResponse.json(makeSeriesAnalysisScopeStatus({ artifactId: artifactId! }));
      }),
      http.get("/api/analytics/series-comparison/v5/aggregate", ({ request }) => {
        const artifactId = new URL(request.url).searchParams.get("artifactId");
        requestedAggregates.push(artifactId);
        return HttpResponse.json(
          makeSeriesAnalysisAggregate({ ...artifact, artifactId: artifactId! }),
        );
      }),
    );
    const { result } = await renderEvaluation();
    requestedScopes.length = 0;
    requestedAggregates.length = 0;
    artifact = { ...artifact, artifactId: "artifact-next" };
    await act(async () => {
      await result.current.refresh(() => true);
    });
    await waitFor(() => expect(result.current.evaluation?.key).toBe("artifact-next::"));
    expect(requestedScopes).toEqual(["artifact-next"]);
    expect(requestedAggregates).toEqual(["artifact-next"]);
  });

  it.each(["authorization", "editor"] as const)(
    "stops an accepted refresh when its %s owner ends during the status read",
    async (owner) => {
      const statusStarted = createDeferred();
      const statusGate = createDeferred();
      let refreshing = false;
      let canContinue = true;
      const requestedScopes: string[] = [];
      server.use(
        http.get("/api/analytics/series-comparison/v2/status", async () => {
          if (refreshing) {
            statusStarted.resolve();
            await statusGate.promise;
          }
          return HttpResponse.json(makeSeriesAnalysisStatus());
        }),
        http.get("/api/analytics/series-comparison/v2/scope-status", ({ request }) => {
          requestedScopes.push(request.url);
          return HttpResponse.json(makeSeriesAnalysisScopeStatus());
        }),
      );
      const { result, rerender } = await renderEvaluation();
      requestedScopes.length = 0;
      refreshing = true;
      let refresh: Promise<void>;
      await act(async () => {
        refresh = result.current.refresh(() => canContinue);
        await statusStarted.promise;
      });
      if (owner === "authorization") canContinue = false;
      else rerender(false);
      await act(async () => {
        statusGate.resolve();
        await refresh;
      });
      expect(requestedScopes).toEqual([]);
      if (owner === "editor") expect(result.current.evaluation).toBeNull();
      else expect(result.current.evaluation?.key).toBe(`${analysisArtifact.artifactId}::`);
    },
  );
});
