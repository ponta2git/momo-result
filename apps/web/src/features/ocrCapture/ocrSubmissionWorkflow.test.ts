// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import {
  createOcrSubmissionState,
  runOcrSubmissionWorkflow,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type { OcrSubmissionWorkflowParams } from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type { SlotKind } from "@/shared/domain/ocr";

function selectedSlot(kind: SlotKind): CaptureSlotState {
  return { file: new File([kind], `${kind}.png`, { type: "image/png" }), kind, status: "selected" };
}

function submission(): OcrSubmissionWorkflowParams {
  return {
    putSubmission: vi.fn<OcrSubmissionWorkflowParams["putSubmission"]>(async (id, request) => ({
      submissionId: id,
      matchDraftId: request.matchDraftId,
      status: "open",
      admissionDeadline: "2026-02-03T04:15:06.000Z",
      members:
        request.members?.map((member) => ({ screenType: member.screenType, status: "pending" })) ??
        [],
    })),
    getJob: vi.fn(),
    createDraft: vi.fn(async () => ({
      matchDraftId: "draft-1",
      status: "ocr_running",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })),
    uploadImage: vi.fn(async (file) => ({ imageId: file.name })),
    createJob: vi.fn(async (request) => ({
      jobId: `job-${request.imageId}`,
      draftId: `ocr-${request.imageId}`,
      status: "queued",
    })),
    hints: {},
    playedAt: "2026-02-03T04:05:06.000Z",
    state: createOcrSubmissionState(),
    selectedGameTitle: { id: "gt_momotetsu_2", layoutFamily: "momotetsu_2" },
    setup: {
      gameTitleId: "gt_momotetsu_2",
      mapMasterId: "map_east",
      ownerMemberId: "member_ponta",
      seasonMasterId: "season_current",
    },
    slots: [selectedSlot("total_assets"), selectedSlot("revenue")],
    updateSlot: vi.fn(),
    onProgress: vi.fn(),
  };
}

describe("runOcrSubmissionWorkflow", () => {
  it("uses the confirmation timestamp and explicit screen hints for the complete draft", async () => {
    const input = submission();
    expect(await runOcrSubmissionWorkflow(input)).toEqual({
      status: "started",
      createdJobCount: 2,
      failedJobCount: 0,
    });
    expect(input.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ playedAt: input.playedAt, status: "ocr_running" }),
      { idempotencyKey: input.state.draftKey },
    );
    expect(input.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: input.state.submissionId,
        requestedScreenType: "revenue",
        imageId: "revenue.png",
      }),
      expect.anything(),
    );
  });

  it("fixes membership and hashes before uploading, and replays an uncertain PUT verbatim", async () => {
    const input = submission();
    const put = input.putSubmission;
    input.putSubmission = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockImplementation(put);
    expect((await runOcrSubmissionWorkflow(input)).status).toBe("submission_failed");
    expect(input.uploadImage).not.toHaveBeenCalled();
    expect((await runOcrSubmissionWorkflow(input)).status).toBe("started");
    expect(vi.mocked(input.putSubmission).mock.calls[0]).toEqual(
      vi.mocked(input.putSubmission).mock.calls[1],
    );
    expect(input.state.request?.members).toEqual(
      input.slots.map((slot) => ({
        screenType: slot.kind,
        uploadIdempotencyKey: input.state.slots[slot.kind]?.key,
        imageSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        imageByteLength: slot.file?.size,
      })),
    );
  });

  it("recovers a registered member after the image response is lost without uploading again", async () => {
    const input = submission();
    input.slots = [selectedSlot("total_assets")];
    input.putSubmission = vi.fn(async (id) => ({
      submissionId: id,
      matchDraftId: "draft-1",
      status: "settled",
      admissionDeadline: "2026-02-03T04:15:06.000Z",
      members: [{ screenType: "total_assets", status: "registered", jobId: "accepted-job" }],
    }));
    input.getJob = vi
      .fn()
      .mockResolvedValue({ jobId: "accepted-job", draftId: "accepted-ocr", status: "succeeded" });
    expect((await runOcrSubmissionWorkflow(input)).status).toBe("started");
    expect(input.getJob).toHaveBeenCalledWith("accepted-job");
    expect(input.uploadImage).not.toHaveBeenCalled();
    expect(input.createJob).not.toHaveBeenCalled();
  });

  it("offers an explicit new submission only for definitively unregistered members", async () => {
    const input = submission();
    input.putSubmission = vi.fn(async (id) => ({
      submissionId: id,
      matchDraftId: "draft-1",
      status: "settled",
      admissionDeadline: "2026-02-03T04:15:06.000Z",
      members: [
        { screenType: "total_assets", status: "registered", jobId: "accepted-job" },
        { screenType: "revenue", status: "failed", failureCode: "admission_timeout" },
      ],
    }));
    expect(await runOcrSubmissionWorkflow(input)).toEqual({
      status: "submission_closed",
      canRestart: true,
    });
    expect(input.state.retryKinds).toEqual(["revenue"]);
    expect(input.uploadImage).not.toHaveBeenCalled();
    expect(input.createJob).not.toHaveBeenCalled();
  });

  it("does not create server resources when an image cannot be read", async () => {
    const input = submission();
    vi.spyOn(input.slots[0]!.file!, "arrayBuffer").mockRejectedValue(new Error("unreadable"));
    expect((await runOcrSubmissionWorkflow(input)).status).toBe("invalid");
    expect(input.createDraft).not.toHaveBeenCalled();
    expect(input.putSubmission).not.toHaveBeenCalled();
  });

  it("replays the identical draft request after its response is lost", async () => {
    const input = submission();
    const accepted = await input.createDraft({}, { idempotencyKey: "fixture" });
    input.createDraft = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(accepted);
    expect((await runOcrSubmissionWorkflow(input)).status).toBe("draft_create_failed");
    expect((await runOcrSubmissionWorkflow(input)).status).toBe("started");
    const calls = vi.mocked(input.createDraft).mock.calls;
    expect(calls[0]).toEqual(calls[1]);
    expect(input.uploadImage).toHaveBeenCalledTimes(2);
  });

  it("reuses accepted uploads and job keys after a job response is lost without cancelling the draft", async () => {
    const input = submission();
    const keys: string[] = [];
    input.createJob = vi.fn(async (request, options) => {
      keys.push(options.idempotencyKey);
      if (keys.length <= 2) throw new Error("response lost after commit");
      return { jobId: request.imageId, draftId: request.imageId, status: "queued" };
    });
    expect(await runOcrSubmissionWorkflow(input)).toEqual({
      status: "submission_failed",
      matchDraftId: "draft-1",
    });
    expect((await runOcrSubmissionWorkflow(input)).status).toBe("started");
    expect(input.createDraft).toHaveBeenCalledTimes(1);
    expect(input.uploadImage).toHaveBeenCalledTimes(2);
    expect(keys.slice(0, 2)).toEqual(keys.slice(2));
  });

  it("retries only incomplete stages after partial registration", async () => {
    const input = submission();
    let revenueAttempts = 0;
    input.createJob = vi.fn(async (request) => {
      if (request.requestedScreenType === "revenue" && revenueAttempts++ === 0)
        throw new Error("unavailable");
      return { jobId: request.imageId, draftId: request.imageId, status: "queued" };
    });
    expect(await runOcrSubmissionWorkflow(input)).toEqual({
      status: "partial_started",
      createdJobCount: 1,
      failedJobCount: 1,
    });
    expect(await runOcrSubmissionWorkflow(input)).toEqual({
      status: "started",
      createdJobCount: 2,
      failedJobCount: 0,
    });
    expect(input.createDraft).toHaveBeenCalledTimes(1);
    expect(input.uploadImage).toHaveBeenCalledTimes(2);
    expect(input.createJob).toHaveBeenCalledTimes(3);
  });

  it("keeps the upload idempotency key when an upload response is lost", async () => {
    const input = submission();
    input.slots = [selectedSlot("total_assets")];
    input.uploadImage = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue({ imageId: "image-1" });
    expect((await runOcrSubmissionWorkflow(input)).status).toBe("submission_failed");
    expect((await runOcrSubmissionWorkflow(input)).status).toBe("started");
    const calls = vi.mocked(input.uploadImage).mock.calls;
    expect(calls[0]).toEqual(calls[1]);
    expect(input.createDraft).toHaveBeenCalledTimes(1);
    expect(input.createJob).toHaveBeenCalledTimes(1);
  });
});
