import { http, HttpResponse } from "msw";

import type { SeriesAnalysisRecalculationAccepted } from "@/shared/api/seriesAnalysis";
import { makePlayerRadarState } from "@/test/msw/playerRadarFixtures";
import {
  makeSeriesAnalysisAdminOverview,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisDrilldown,
  makeSeriesAnalysisMatchContext,
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisReview,
  makeSeriesAnalysisStatus,
  makeSeriesAnalysisScopeStatus,
} from "@/test/msw/seriesAnalysisFixtures";

export const seriesAnalysisHandlers = [
  http.get("/api/admin/series-analysis/radar", ({ request }) =>
    HttpResponse.json(
      makePlayerRadarState(
        new URL(request.url).searchParams.get("gameTitleId") ?? "gt_momotetsu_2",
      ),
    ),
  ),
  http.get("/api/analytics/series-comparison/v2/scope-status", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const seasonMasterId = params.get("seasonMasterId");
    const mapMasterId = params.get("mapMasterId");
    const title = makeSeriesAnalysisOptions().titles.find(
      (entry) => entry.gameTitleId === params.get("gameTitleId"),
    );
    const season = title?.seasons.find((entry) => entry.seasonMasterId === seasonMasterId);
    const map = title?.maps.find((entry) => entry.mapMasterId === mapMasterId);
    const invalidFields = [
      ...(seasonMasterId && !season ? ["seasonMasterId"] : []),
      ...(mapMasterId && !map ? ["mapMasterId"] : []),
    ];
    return HttpResponse.json(
      makeSeriesAnalysisScopeStatus({
        gameTitleId: params.get("gameTitleId") ?? "gt_momotetsu_2",
        artifactId: params.get("artifactId"),
        seasonMasterId,
        mapMasterId,
        seasonName: season?.displayName ?? null,
        mapName: map?.displayName ?? null,
        state: invalidFields.length > 0 ? "invalid" : "available",
        invalidFields,
      }),
    );
  }),
  http.get("/api/analytics/series-comparison/v2/options", () =>
    HttpResponse.json(makeSeriesAnalysisOptions()),
  ),
  http.get("/api/analytics/series-comparison/v2/status", () =>
    HttpResponse.json(makeSeriesAnalysisStatus()),
  ),
  http.get("/api/analytics/series-comparison/v5/aggregate", () =>
    HttpResponse.json(makeSeriesAnalysisAggregate()),
  ),
  http.get("/api/analytics/series-comparison/v3/review", () =>
    HttpResponse.json(makeSeriesAnalysisReview()),
  ),
  http.get("/api/analytics/series-comparison/v2/drilldown", ({ request }) =>
    HttpResponse.json(
      makeSeriesAnalysisDrilldown(new URL(request.url).searchParams.get("metricId") ?? ""),
    ),
  ),
  http.get("/api/analytics/series-comparison/v3/match-context", ({ request }) => {
    const matchId = new URL(request.url).searchParams.get("matchId") ?? "match-12";
    const context = makeSeriesAnalysisMatchContext();
    return HttpResponse.json({
      ...context,
      matchId,
      match: context.match
        ? {
            ...context.match,
            focusedItemIds: context.match.focusedItemIds.map((itemId) =>
              itemId.replace("match-12", matchId),
            ),
            matchIndex: matchId === "match-1" ? 1 : context.match.matchIndex,
          }
        : null,
    });
  }),
  http.get("/api/admin/series-analysis/overview", () =>
    HttpResponse.json(makeSeriesAnalysisAdminOverview()),
  ),
  http.post("/api/admin/series-analysis/recalculations", () =>
    HttpResponse.json(
      {
        acceptedAt: "2026-08-09T02:00:00.000Z",
        campaign: null,
        requestId: "request-title",
        schemaVersion: 1,
        target: {
          gameTitleId: "gt_momotetsu_2",
          jobId: "job-2",
          requestDisposition: "created_job",
        },
        targetCount: 1,
      } satisfies SeriesAnalysisRecalculationAccepted,
      { status: 202 },
    ),
  ),
  http.post("/api/admin/series-analysis/recalculations/all", () =>
    HttpResponse.json(
      {
        acceptedAt: "2026-08-09T02:00:00.000Z",
        campaign: { campaignId: "campaign-1", status: "expanding" },
        requestId: "request-all",
        schemaVersion: 1,
        target: null,
        targetCount: 1,
      } satisfies SeriesAnalysisRecalculationAccepted,
      { status: 202 },
    ),
  ),
];
