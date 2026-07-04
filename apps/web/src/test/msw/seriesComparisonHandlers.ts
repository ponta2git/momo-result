import { http, HttpResponse } from "msw";

import {
  makeSeriesComparisonDrilldownResponse,
  makeSeriesComparisonPlayOrderDrilldownResponse,
  makeSeriesComparisonResponse,
  makeSeriesComparisonReviewResponse,
} from "@/test/msw/seriesComparisonFixtures";

export {
  makeSeriesComparisonDrilldownResponse,
  makeSeriesComparisonPlayOrderDrilldownResponse,
  makeSeriesComparisonResponse,
  makeSeriesComparisonReviewResponse,
} from "@/test/msw/seriesComparisonFixtures";

export const seriesComparisonHandlers = [
  http.get("/api/analytics/series-comparison/options", () =>
    HttpResponse.json({
      latestConfirmedGameTitleId: "gt_momotetsu_2",
      schemaVersion: 1,
      series: [
        {
          confirmedMatchCount: 12,
          displayOrder: 1,
          gameTitleId: "gt_momotetsu_2",
          latestConfirmedPlayedAt: "2026-05-10T12:00:00.000Z",
          layoutFamily: "momotetsu_2",
          maps: [{ confirmedMatchCount: 12, displayOrder: 1, id: "map_east", name: "東日本編" }],
          name: "桃太郎電鉄2",
          seasons: [
            { confirmedMatchCount: 12, displayOrder: 1, id: "season_current", name: "今シーズン" },
          ],
        },
      ],
    }),
  ),
  http.get("/api/analytics/series-comparison", () =>
    HttpResponse.json(makeSeriesComparisonResponse()),
  ),
  http.get("/api/analytics/series-comparison/drilldown", ({ request }) => {
    const url = new URL(request.url);
    const memberId = url.searchParams.get("memberId") ?? "member_ponta";
    const metricId = url.searchParams.get("metricId");
    return HttpResponse.json(
      metricId === "playOrder.rankHistory"
        ? makeSeriesComparisonPlayOrderDrilldownResponse(memberId)
        : makeSeriesComparisonDrilldownResponse(memberId),
    );
  }),
  http.get("/api/analytics/series-comparison/review", () =>
    HttpResponse.json(makeSeriesComparisonReviewResponse()),
  ),
];
