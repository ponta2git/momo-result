import { requestedImageTypeForSlot } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { setupSchema } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { pickOcrTargets, toUploadingSlot } from "@/features/ocrCapture/slotPolicy";
import { parseOcrJobStatus } from "@/shared/api/enums";
import type { CreateMatchDraftRequest, MatchDraftResponse } from "@/shared/api/matchDrafts";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";

export type OcrSubmissionResult =
  | { status: "empty" }
  | { message: string; status: "invalid" }
  | { error: unknown; status: "draft_create_failed" }
  | { cleanupError?: undefined; status: "failed_and_cancelled" }
  | { cleanupError: unknown; matchDraftId: string; status: "failed_cleanup_failed" }
  | { createdJobCount: number; failedJobCount: number; status: "started" | "partial_started" };

export type OcrSubmissionWorkflowParams = {
  cancelDraft: (matchDraftId: string) => Promise<unknown>;
  createDraft: (request: CreateMatchDraftRequest) => Promise<MatchDraftResponse>;
  createUploadJob: (params: {
    file: File;
    matchDraftId: string;
    slot: CaptureSlotState;
  }) => Promise<{
    job: { draftId?: string; jobId: string; status: string };
    upload: { imageId: string };
  }>;
  onReady?: ((targetCount: number) => void) | undefined;
  selectedGameTitle: { id: string; layoutFamily?: string | null } | undefined;
  setup: SetupFormValues;
  slots: readonly CaptureSlotState[];
  updateSlot: (slot: CaptureSlotState) => void;
};

export async function runOcrSubmissionWorkflow({
  cancelDraft,
  createDraft,
  createUploadJob,
  onReady,
  selectedGameTitle,
  setup,
  slots,
  updateSlot,
}: OcrSubmissionWorkflowParams): Promise<OcrSubmissionResult> {
  const targetSlots = pickOcrTargets(slots);
  if (targetSlots.length === 0) {
    return { status: "empty" };
  }

  const setupSubmission = setupSchema.safeParse(setup);
  if (!setupSubmission.success) {
    return {
      message: setupSubmission.error.issues[0]?.message ?? "試合設定を確認してください。",
      status: "invalid",
    };
  }
  onReady?.(targetSlots.length);

  let matchDraftId: string | null;
  try {
    const matchDraft = await createDraft({
      gameTitleId: setup.gameTitleId,
      ...(selectedGameTitle?.layoutFamily ? { layoutFamily: selectedGameTitle.layoutFamily } : {}),
      mapMasterId: setup.mapMasterId,
      ownerMemberId: setup.ownerMemberId,
      playedAt: new Date().toISOString(),
      seasonMasterId: setup.seasonMasterId,
      status: "ocr_running",
    });
    matchDraftId = matchDraft.matchDraftId;
  } catch (error) {
    return { error, status: "draft_create_failed" };
  }
  if (!matchDraftId) {
    return { error: new Error("matchDraftId was not returned"), status: "draft_create_failed" };
  }

  let createdJobCount = 0;
  let failedJobCount = 0;
  for (const slot of targetSlots) {
    if (!slot.file) continue;
    const uploadingSlot = toUploadingSlot(slot);
    updateSlot(uploadingSlot);
    try {
      const { upload, job } = await createUploadJob({
        matchDraftId,
        slot: uploadingSlot,
        file: slot.file,
      });
      const status = parseOcrJobStatus(job.status);
      updateSlot({
        ...uploadingSlot,
        imageId: upload.imageId,
        jobId: job.jobId,
        draftId: job.draftId,
        status: status === "unknown" ? "queued" : status,
      });
      createdJobCount += 1;
    } catch (error) {
      failedJobCount += 1;
      updateSlot({
        ...uploadingSlot,
        status: "failed",
        transportError: normalizeDisplayApiError(error, "読み取り処理を開始できませんでした"),
      });
    }
  }

  if (createdJobCount > 0) {
    return {
      createdJobCount,
      failedJobCount,
      status: failedJobCount > 0 ? "partial_started" : "started",
    };
  }

  try {
    await cancelDraft(matchDraftId);
    return { status: "failed_and_cancelled" };
  } catch (cleanupError) {
    return { cleanupError, matchDraftId, status: "failed_cleanup_failed" };
  }
}

export function ocrJobRequestForSlot(
  matchDraftId: string,
  slot: CaptureSlotState,
  imageId: string,
  hints: Record<string, unknown>,
) {
  return {
    imageId,
    matchDraftId,
    requestedImageType: requestedImageTypeForSlot(slot),
    ocrHints: hints,
  };
}
