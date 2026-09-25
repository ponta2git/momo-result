import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { readSeriesAnalysisMatchContext } from "@/shared/api/seriesAnalysisMatchContextState";
import {
  seriesAnalysisAdminOverviewQueryOptions,
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisMatchContext } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

describe("series analysis live query options", () => {
  it.each([
    [404, "NOT_FOUND"],
    [410, "ANALYSIS_ARTIFACT_EXPIRED"],
  ] as const)(
    "retains a definitive %s result through later transport failures until recovery",
    async (status, code) => {
      setDevUser();
      const context = makeSeriesAnalysisMatchContext();
      let response: "success" | "invalid" | "transient" = "success";
      server.use(
        http.get("/api/analytics/series-comparison/v3/match-context", () => {
          if (response === "success") return HttpResponse.json(context);
          const responseStatus = response === "invalid" ? status : 503;
          return HttpResponse.json(
            {
              type: "about:blank",
              title: "Unavailable",
              detail: "Unavailable",
              status: responseStatus,
              code: response === "invalid" ? code : "SERVICE_UNAVAILABLE",
            },
            { status: responseStatus },
          );
        }),
      );
      const client = createTestQueryClient();
      const options = seriesAnalysisMatchContextQueryOptions({
        artifactId: context.artifact.artifactId,
        gameTitleId: context.artifact.gameTitleId,
        matchId: context.matchId,
      });
      await client.fetchQuery(options);
      expect(
        readSeriesAnalysisMatchContext({ data: client.getQueryData(options.queryKey), error: null })
          .context,
      ).toEqual(context);
      response = "invalid";
      await client.fetchQuery(options);
      response = "transient";
      await expect(client.fetchQuery(options)).rejects.toMatchObject({ status: 503 });
      const invalid = readSeriesAnalysisMatchContext({
        data: client.getQueryData(options.queryKey),
        error: client.getQueryState(options.queryKey)?.error,
      });
      expect(invalid.context).toBeUndefined();
      expect(invalid.unavailable).toBe(true);
      expect(invalid.error).toMatchObject({ status, code });
      response = "success";
      await client.fetchQuery(options);
      expect(
        readSeriesAnalysisMatchContext({
          data: client.getQueryData(options.queryKey),
          error: null,
        }),
      ).toEqual({
        context,
        error: null,
        unavailable: false,
      });
      client.clear();
    },
  );
  it.each([
    ["status", seriesAnalysisStatusQueryOptions("game-title-1")],
    ["admin overview", seriesAnalysisAdminOverviewQueryOptions("game-title-1")],
  ])("does not poll %s", (_, options) => {
    expect(options).not.toHaveProperty("refetchInterval");
    expect(options).not.toHaveProperty("refetchIntervalInBackground");
  });
});
