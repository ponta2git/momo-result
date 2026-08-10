import { http, HttpResponse } from "msw";

import type { SeriesAnalysisRecalculationAccepted } from "@/shared/api/seriesAnalysis";
import {
  makeSeriesAnalysisAdminOverview,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisDrilldown,
  makeSeriesAnalysisMatchContext,
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisReview,
  makeSeriesAnalysisStatus,
} from "@/test/msw/seriesAnalysisFixtures";

export const seriesAnalysisHandlers = [
  http.get("/api/analytics/series-comparison/v2/options", () =>
    HttpResponse.json(makeSeriesAnalysisOptions()),
  ),
  http.get("/api/analytics/series-comparison/v2/status", () =>
    HttpResponse.json(makeSeriesAnalysisStatus()),
  ),
  http.get("/api/analytics/series-comparison/v2/aggregate", () =>
    HttpResponse.json(makeSeriesAnalysisAggregate()),
  ),
  http.get("/api/analytics/series-comparison/v2/review", () =>
    HttpResponse.json(makeSeriesAnalysisReview()),
  ),
  http.get("/api/analytics/series-comparison/v2/drilldown", ({ request }) =>
    HttpResponse.json(
      makeSeriesAnalysisDrilldown(new URL(request.url).searchParams.get("metricId") ?? ""),
    ),
  ),
  http.get("/api/analytics/series-comparison/v2/match-context", ({ request }) => {
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
