import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import {
  getSeriesAnalysisOutlookSummary,
  getSeriesAnalysisOutlookExamples,
} from "@/shared/api/seriesAnalysis";
import { seriesAnalysisOutlookWindowQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisOutlookSummary,
  makeSeriesAnalysisOutlookWindow,
  makeSeriesAnalysisOutlookExamples,
} from "@/test/msw/seriesAnalysisOutlookFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

describe("outlook artifact reads", () => {
  it("reads a normal empty summary and a finite examples projection through generated decoders", async () => {
    setDevUser();
    const summary = await makeSeriesAnalysisOutlookSummary({}, true);
    const examples = await makeSeriesAnalysisOutlookExamples();
    server.use(
      http.get("/api/analytics/series-comparison/v1/outlook-summary", ({ request }) => {
        const query = new URL(request.url).searchParams;
        expect(query.get("artifactId")).toBe(summary.artifact.artifactId);
        expect(query.get("gameTitleId")).toBe(summary.artifact.gameTitleId);
        expect(query.has("mapMasterId")).toBe(false);
        return HttpResponse.json(summary);
      }),
      http.get("/api/analytics/series-comparison/v1/outlook-examples", ({ request }) => {
        expect(new URL(request.url).searchParams.get("memberId")).toBe(examples.memberId);
        return HttpResponse.json(examples);
      }),
    );
    const query = {
      gameTitleId: summary.artifact.gameTitleId,
      artifactId: summary.artifact.artifactId,
    };
    await expect(getSeriesAnalysisOutlookSummary(query)).resolves.toMatchObject({
      qualityStatus: "no_target",
      players: [],
    });
    await expect(
      getSeriesAnalysisOutlookExamples({ ...query, memberId: examples.memberId }),
    ).resolves.toEqual(examples);
  });

  it("keeps different requested windows and normal insufficiency separate in the artifact cache", async () => {
    setDevUser();
    const first = await makeSeriesAnalysisOutlookWindow(1);
    const absent = await makeSeriesAnalysisOutlookWindow(1000);
    server.use(
      http.get("/api/analytics/series-comparison/v1/outlook-window", ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("windowSize") === "1" ? first : absent,
        ),
      ),
    );
    const client = createTestQueryClient();
    const query = {
      artifactId: first.artifact.artifactId,
      gameTitleId: first.artifact.gameTitleId,
      memberId: first.memberId,
    };
    const one = seriesAnalysisOutlookWindowQueryOptions({ ...query, windowSize: 1 });
    const thousand = seriesAnalysisOutlookWindowQueryOptions({ ...query, windowSize: 1000 });
    try {
      await expect(client.fetchQuery(one)).resolves.toMatchObject({
        status: "available",
        windowSize: 1,
      });
      await expect(client.fetchQuery(thousand)).resolves.toMatchObject({
        status: "insufficient",
        windowSize: 1000,
        window: null,
      });
      expect(client.getQueryData(one.queryKey)).toEqual(first);
    } finally {
      client.clear();
    }
  });

  it("rejects a response from an obsolete artifact generation before exposing it to consumers", async () => {
    setDevUser();
    const summary = await makeSeriesAnalysisOutlookSummary();
    server.use(
      http.get("/api/analytics/series-comparison/v1/outlook-summary", () =>
        HttpResponse.json({
          ...summary,
          artifact: { ...summary.artifact, artifactSchemaVersion: 5 },
        }),
      ),
    );
    await expect(
      getSeriesAnalysisOutlookSummary({
        artifactId: summary.artifact.artifactId,
        gameTitleId: summary.artifact.gameTitleId,
      }),
    ).rejects.toMatchObject({ kind: "api" });
  });
});
