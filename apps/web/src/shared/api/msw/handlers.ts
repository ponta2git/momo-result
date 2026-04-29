import { http, HttpResponse } from "msw";

const now = "2026-01-01T00:00:00.000Z";

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
  http.delete("/api/ocr-jobs/:jobId", ({ params }) =>
    HttpResponse.json({
      jobId: params.jobId,
      status: "cancelled",
    }),
  ),
];
