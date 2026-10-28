import { http, HttpResponse } from "msw";

import type { HeldEventListItemResponse } from "@/shared/api/heldEvents";
import {
  makeHeldEventDetailResponse,
  makeHeldEventListItem,
  makeHeldEventResponse,
} from "@/test/factories/heldEvents";
import { now } from "@/test/msw/fixtures";

function pagination(page: number, pageSize: number, totalItems: number) {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  return {
    hasNextPage: totalPages > 0 && page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
    page,
    pageSize,
    totalItems,
    totalPages,
  };
}

/** Search conditions are evaluated over confirmed matches; the default fixture event has none. */
const confirmedMatchConditions = [
  "gameTitleId",
  "seasonMasterId",
  "mapMasterId",
  "q",
  "metric",
] as const;

function matchesListConditions(item: HeldEventListItemResponse, params: URLSearchParams) {
  if (confirmedMatchConditions.some((key) => params.has(key)) && item.matchCount === 0) {
    return false;
  }
  const minMatchCount = Number(params.get("minMatchCount") ?? "0");
  if (item.matchCount < minMatchCount) return false;
  const day = item.heldAt.slice(0, 10);
  const from = params.get("from");
  const to = params.get("to");
  return (!from || day >= from) && (!to || day <= to);
}

export const heldEventHandlers = [
  http.get("/api/held-events", ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(
      url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? "10",
    );
    const all = [makeHeldEventListItem({ heldAt: now })];
    const ordered = url.searchParams.get("sort") === "held_asc" ? all.toReversed() : all;
    const items = ordered.filter((item) => matchesListConditions(item, url.searchParams));
    const offset = (page - 1) * pageSize;
    return HttpResponse.json({
      items: items.slice(offset, offset + pageSize),
      latestHeldEventId: all[0]?.id,
      pagination: pagination(page, pageSize, items.length),
      totalMatchCount: items.reduce((sum, item) => sum + item.matchCount, 0),
    });
  }),
  http.post("/api/held-events", async () =>
    HttpResponse.json(makeHeldEventResponse({ heldAt: now, id: "held-created" })),
  ),
  http.get("/api/held-events/:heldEventId/summary", ({ params }) =>
    HttpResponse.json(makeHeldEventResponse({ heldAt: now, id: String(params["heldEventId"]) })),
  ),
  http.get("/api/held-events/:heldEventId", ({ params }) =>
    HttpResponse.json(
      makeHeldEventDetailResponse({
        heldAt: now,
        id: String(params["heldEventId"]),
      }),
    ),
  ),
  http.delete("/api/held-events/:heldEventId", ({ params }) =>
    HttpResponse.json({
      deleted: true,
      heldEventId: String(params["heldEventId"]),
    }),
  ),
];
