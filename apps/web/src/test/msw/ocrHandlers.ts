import { http, HttpResponse } from "msw";

import { draftPayload, now } from "@/test/msw/fixtures";

export const ocrHandlers = [
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
      draftId: "draft-1",
      jobId: "job-1",
      status: "queued",
    }),
  ),
  http.get("/api/ocr-jobs/:jobId", () =>
    HttpResponse.json({
      attemptCount: 1,
      createdAt: now,
      detectedImageType: "total_assets",
      draftId: "draft-1",
      imageId: "image-1",
      imagePath: "/tmp/ignored.png",
      jobId: "job-1",
      requestedImageType: "auto",
      status: "succeeded",
      updatedAt: now,
    }),
  ),
  http.delete("/api/ocr-jobs/:jobId", ({ params }) =>
    HttpResponse.json({
      jobId: params["jobId"],
      status: "cancelled",
    }),
  ),
  http.get("/api/ocr-drafts/:draftId", () =>
    HttpResponse.json({
      createdAt: now,
      detectedImageType: "total_assets",
      draftId: "draft-1",
      jobId: "job-1",
      payloadJson: { players: [] },
      profileId: "momotetsu_2.total_assets.v1",
      requestedImageType: "auto",
      timingsMsJson: {},
      updatedAt: now,
      warningsJson: [],
    }),
  ),
  http.get("/api/ocr-drafts", ({ request }) => {
    const url = new URL(request.url);
    const ids = url.searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
    if (ids.length === 0) {
      return HttpResponse.json(
        {
          code: "VALIDATION_FAILED",
          detail: "ids query must contain at least 1 id.",
          status: 422,
          title: "Validation Failed",
          type: "about:blank",
        },
        { status: 422 },
      );
    }
    return HttpResponse.json({
      items: ids.map((draftId) => ({
        createdAt: now,
        detectedImageType: "total_assets",
        draftId,
        jobId: `job-${draftId}`,
        payloadJson: draftPayload,
        profileId: "momotetsu_2.total_assets.v1",
        requestedImageType: "auto",
        timingsMsJson: {},
        updatedAt: now,
        warningsJson: [],
      })),
    });
  }),
];
