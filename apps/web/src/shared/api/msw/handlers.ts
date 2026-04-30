import { http, HttpResponse } from "msw";

const now = "2026-01-01T00:00:00.000Z";
const playerField = (value: unknown, confidence = 0.96) => ({
  value,
  raw_text: value == null ? null : String(value),
  confidence,
  warnings: [],
});
const draftPayload = {
  requested_screen_type: "total_assets",
  detected_screen_type: "total_assets",
  profile_id: "momotetsu_2.total_assets.v1",
  players: [
    {
      raw_player_name: playerField("ぽんた"),
      member_id: "member_ponta",
      play_order: playerField(1),
      rank: playerField(1),
      total_assets_man_yen: playerField(1000),
      revenue_man_yen: playerField(100),
      incidents: {},
    },
  ],
  category_payload: {},
  warnings: [],
  raw_snippets: null,
};

export const handlers = [
  http.get("/api/auth/me", ({ request }) => {
    const devUser = request.headers.get("X-Dev-User");
    if (!devUser) {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "dev user is required",
          code: "UNAUTHORIZED",
        },
        { status: 401 },
      );
    }
    return HttpResponse.json({ memberId: devUser, displayName: devUser });
  }),
  http.post("/api/uploads/images", async () =>
    HttpResponse.json({
      imageId: "image-1",
      imagePath: "/tmp/ignored.png",
      mediaType: "image/png",
      sizeBytes: 100,
    }),
  ),
  http.post("/api/ocr-jobs", async () =>
    HttpResponse.json({
      jobId: "job-1",
      draftId: "draft-1",
      status: "queued",
    }),
  ),
  http.get("/api/ocr-jobs/:jobId", () =>
    HttpResponse.json({
      jobId: "job-1",
      draftId: "draft-1",
      imageId: "image-1",
      imagePath: "/tmp/ignored.png",
      requestedImageType: "auto",
      detectedImageType: "total_assets",
      status: "succeeded",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    }),
  ),
  http.get("/api/ocr-drafts/:draftId", () =>
    HttpResponse.json({
      draftId: "draft-1",
      jobId: "job-1",
      requestedImageType: "auto",
      detectedImageType: "total_assets",
      profileId: "momotetsu_2.total_assets.v1",
      payloadJson: { players: [] },
      warningsJson: [],
      timingsMsJson: {},
      createdAt: now,
      updatedAt: now,
    }),
  ),
  http.get("/api/ocr-drafts", ({ request }) => {
    const url = new URL(request.url);
    const ids = url.searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
    if (ids.length === 0) {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Validation Failed",
          status: 422,
          detail: "ids query must contain at least 1 id.",
          code: "VALIDATION_FAILED",
        },
        { status: 422 },
      );
    }
    return HttpResponse.json({
      items: ids.map((draftId) => ({
        draftId,
        jobId: `job-${draftId}`,
        requestedImageType: "auto",
        detectedImageType: "total_assets",
        profileId: "momotetsu_2.total_assets.v1",
        payloadJson: draftPayload,
        warningsJson: [],
        timingsMsJson: {},
        createdAt: now,
        updatedAt: now,
      })),
    });
  }),
  http.get("/api/held-events", () =>
    HttpResponse.json({
      items: [
        {
          id: "held-1",
          heldAt: now,
          matchCount: 0,
        },
      ],
    }),
  ),
  http.post("/api/held-events", async () =>
    HttpResponse.json({
      id: "held-created",
      heldAt: now,
      matchCount: 0,
    }),
  ),
  http.post("/api/matches", async () =>
    HttpResponse.json({
      matchId: "match-1",
      heldEventId: "held-1",
      matchNoInEvent: 1,
      createdAt: now,
    }),
  ),
  http.get("/api/game-titles", () => HttpResponse.json({ items: [] })),
  http.post("/api/game-titles", async () =>
    HttpResponse.json({
      id: "gt-1",
      name: "stub",
      layoutFamily: "momotetsu_2",
      displayOrder: 1,
      createdAt: now,
    }),
  ),
  http.get("/api/map-masters", () => HttpResponse.json({ items: [] })),
  http.post("/api/map-masters", async () =>
    HttpResponse.json({
      id: "map-1",
      gameTitleId: "gt-1",
      name: "stub",
      displayOrder: 1,
      createdAt: now,
    }),
  ),
  http.get("/api/season-masters", () => HttpResponse.json({ items: [] })),
  http.post("/api/season-masters", async () =>
    HttpResponse.json({
      id: "season-1",
      gameTitleId: "gt-1",
      name: "stub",
      displayOrder: 1,
      createdAt: now,
    }),
  ),
  http.get("/api/incident-masters", () => HttpResponse.json({ items: [] })),
  http.delete("/api/ocr-jobs/:jobId", ({ params }) =>
    HttpResponse.json({
      jobId: params.jobId,
      status: "cancelled",
    }),
  ),
];
