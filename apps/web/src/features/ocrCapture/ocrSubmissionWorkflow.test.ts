import { describe, expect, it, vi } from "vitest";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import type { OcrSubmissionWorkflowParams } from "@/features/ocrCapture/ocrSubmissionWorkflow";
import { runOcrSubmissionWorkflow } from "@/features/ocrCapture/ocrSubmissionWorkflow";

const validSetup = {
  gameTitleId: "gt_momotetsu_2",
  mapMasterId: "map_east",
  ownerMemberId: "member_ponta",
  seasonMasterId: "season_current",
};

function selectedSlot(): CaptureSlotState {
  return {
    file: new File(["image"], "assets.png", { type: "image/png" }),
    kind: "total_assets",
    pollAttempts: 0,
    previewUrl: "blob:assets",
    source: "upload",
    status: "selected",
  };
}

describe("runOcrSubmissionWorkflow", () => {
  it("creates a draft with the supplied playedAt timestamp before starting OCR jobs", async () => {
    const createDraftRequests: Array<Parameters<OcrSubmissionWorkflowParams["createDraft"]>[0]> =
      [];
    const slotUpdates: CaptureSlotState[] = [];
    const onReady = vi.fn();
    const slot = selectedSlot();

    const result = await runOcrSubmissionWorkflow({
      cancelDraft: vi.fn(),
      createDraft: async (request) => {
        createDraftRequests.push(request);
        return {
          createdAt: "2026-01-01T00:00:00.000Z",
          matchDraftId: "draft-created-1",
          status: "ocr_running",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      },
      createPlayedAtIso: () => "2026-02-03T04:05:06.000Z",
      createUploadJob: async ({ file, matchDraftId, slot: uploadingSlot }) => {
        expect(file).toBe(slot.file);
        expect(matchDraftId).toBe("draft-created-1");
        expect(uploadingSlot.status).toBe("uploading");
        return {
          job: { draftId: "draft-1", jobId: "job-1", status: "queued" },
          upload: { imageId: "image-1" },
        };
      },
      onReady,
      selectedGameTitle: { id: "gt_momotetsu_2", layoutFamily: "momotetsu_2" },
      setup: validSetup,
      slots: [slot],
      updateSlot: (nextSlot) => slotUpdates.push(nextSlot),
    });

    expect(onReady).toHaveBeenCalledWith(1);
    expect(createDraftRequests).toEqual([
      {
        gameTitleId: "gt_momotetsu_2",
        layoutFamily: "momotetsu_2",
        mapMasterId: "map_east",
        ownerMemberId: "member_ponta",
        playedAt: "2026-02-03T04:05:06.000Z",
        seasonMasterId: "season_current",
        status: "ocr_running",
      },
    ]);
    expect(slotUpdates.map((nextSlot) => nextSlot.status)).toEqual(["uploading", "queued"]);
    expect(slotUpdates.at(-1)).toMatchObject({
      draftId: "draft-1",
      imageId: "image-1",
      jobId: "job-1",
      status: "queued",
    });
    expect(result).toEqual({ createdJobCount: 1, failedJobCount: 0, status: "started" });
  });
});
