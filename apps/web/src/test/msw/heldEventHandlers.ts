import { http, HttpResponse } from "msw";

import { now } from "@/test/msw/fixtures";

export const heldEventHandlers = [
  http.get("/api/held-events", () =>
    HttpResponse.json({
      items: [
        {
          heldAt: now,
          id: "held-1",
          matchCount: 0,
        },
      ],
    }),
  ),
  http.post("/api/held-events", async () =>
    HttpResponse.json({
      heldAt: now,
      id: "held-created",
      matchCount: 0,
    }),
  ),
  http.delete("/api/held-events/:heldEventId", ({ params }) =>
    HttpResponse.json({
      deleted: true,
      heldEventId: String(params["heldEventId"]),
    }),
  ),
];
