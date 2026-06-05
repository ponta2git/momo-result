import { http, HttpResponse } from "msw";

import { makeHeldEventResponse } from "@/test/factories/heldEvents";
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

export const heldEventHandlers = [
  http.get("/api/held-events", ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(
      url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? "10",
    );
    const items = [makeHeldEventResponse({ heldAt: now })];
    const offset = (page - 1) * pageSize;
    return HttpResponse.json({
      items: items.slice(offset, offset + pageSize),
      pagination: pagination(page, pageSize, items.length),
      totalMatchCount: items.reduce((sum, item) => sum + item.matchCount, 0),
    });
  }),
  http.post("/api/held-events", async () =>
    HttpResponse.json(makeHeldEventResponse({ heldAt: now, id: "held-created" })),
  ),
  http.delete("/api/held-events/:heldEventId", ({ params }) =>
    HttpResponse.json({
      deleted: true,
      heldEventId: String(params["heldEventId"]),
    }),
  ),
];
