// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import type { OcrSubmissionWorkflowParams } from "@/features/ocrCapture/ocrSubmissionWorkflow";
import { runOcrSubmissionWorkflow } from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type { SlotKind } from "@/shared/api/enums";

const validSetup = {
  gameTitleId: "gt_momotetsu_2",
  mapMasterId: "map_east",
  ownerMemberId: "member_ponta",
  seasonMasterId: "season_current",
};

function selectedSlot(kind: SlotKind = "total_assets", fileName = "assets.png"): CaptureSlotState {
  return {
    file: new File(["image"], fileName, { type: "image/png" }),
    kind,
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
    const onProgress = vi.fn();
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
      onProgress,
      selectedGameTitle: { id: "gt_momotetsu_2", layoutFamily: "momotetsu_2" },
      setup: validSetup,
      slots: [slot],
      updateSlot: (nextSlot) => slotUpdates.push(nextSlot),
    });

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { phase: "creating_draft", total: 1 },
      { current: 1, phase: "submitting_image", slotKind: "total_assets", total: 1 },
      { completed: 1, phase: "finalizing", total: 1 },
    ]);
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

  it("creates the draft inside the selected held event using its suggested match number", async () => {
    const createDraft = vi.fn(async () => ({
      createdAt: "2026-02-03T04:05:06.000Z",
      matchDraftId: "draft-held-1",
      status: "ocr_running",
      updatedAt: "2026-02-03T04:05:06.000Z",
    }));

    const result = await runOcrSubmissionWorkflow({
      cancelDraft: vi.fn(),
      createDraft,
      createPlayedAtIso: () => "2026-09-09T09:09:09.000Z",
      createUploadJob: async () => ({
        job: { draftId: "ocr-draft-1", jobId: "job-1", status: "queued" },
        upload: { imageId: "image-1" },
      }),
      selectedGameTitle: { id: "gt_momotetsu_2" },
      selectedHeldEvent: {
        heldAt: "2026-02-03T04:05:06.000Z",
        id: "held-1",
      },
      setup: {
        ...validSetup,
        heldEventId: "held-1",
        matchNoInEvent: 7,
      },
      slots: [selectedSlot()],
      updateSlot: vi.fn(),
    });

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        heldEventId: "held-1",
        matchNoInEvent: 7,
        playedAt: "2026-02-03T04:05:06.000Z",
      }),
    );
    expect(result).toEqual({ createdJobCount: 1, failedJobCount: 0, status: "started" });
  });

  it("reports ordered progress and a partial result when one image cannot be registered", async () => {
    const updates: CaptureSlotState[] = [];
    const progress = vi.fn();
    const cancelDraft = vi.fn();
    const slots = [selectedSlot(), selectedSlot("revenue", "revenue.png")];

    const result = await runOcrSubmissionWorkflow({
      cancelDraft,
      createDraft: async () => ({
        createdAt: "2026-01-01T00:00:00.000Z",
        matchDraftId: "draft-created-1",
        status: "ocr_running",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      createPlayedAtIso: () => "2026-02-03T04:05:06.000Z",
      createUploadJob: async ({ slot }) => {
        if (slot.kind === "revenue") throw new Error("queue unavailable");
        return {
          job: { draftId: "draft-1", jobId: "job-1", status: "queued" },
          upload: { imageId: "image-1" },
        };
      },
      onProgress: progress,
      selectedGameTitle: { id: "gt_momotetsu_2", layoutFamily: "momotetsu_2" },
      setup: validSetup,
      slots,
      updateSlot: (slot) => updates.push(slot),
    });

    expect(result).toEqual({ createdJobCount: 1, failedJobCount: 1, status: "partial_started" });
    expect(cancelDraft).not.toHaveBeenCalled();
    expect(updates.map((slot) => slot.status)).toEqual([
      "uploading",
      "queued",
      "uploading",
      "failed",
    ]);
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { phase: "creating_draft", total: 2 },
      { current: 1, phase: "submitting_image", slotKind: "total_assets", total: 2 },
      { current: 2, phase: "submitting_image", slotKind: "revenue", total: 2 },
      { completed: 2, phase: "finalizing", total: 2 },
    ]);
  });

  it("cancels the draft when every image submission fails", async () => {
    const cancelDraft = vi.fn(async () => undefined);

    const result = await runOcrSubmissionWorkflow({
      cancelDraft,
      createDraft: async () => ({
        createdAt: "2026-01-01T00:00:00.000Z",
        matchDraftId: "draft-created-1",
        status: "ocr_running",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      createPlayedAtIso: () => "2026-02-03T04:05:06.000Z",
      createUploadJob: async () => {
        throw new Error("upload failed");
      },
      selectedGameTitle: { id: "gt_momotetsu_2" },
      setup: validSetup,
      slots: [selectedSlot()],
      updateSlot: vi.fn(),
    });

    expect(cancelDraft).toHaveBeenCalledWith("draft-created-1");
    expect(result).toEqual({ status: "failed_and_cancelled" });
  });
});
