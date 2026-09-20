import { requestedScreenTypeForSlot } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import type { OcrSubmissionInput } from "@/features/ocrCapture/ocrSubmissionPlan";
import { setupSchema } from "@/features/ocrCapture/schema";
import { pickOcrTargets, toUploadingSlot } from "@/features/ocrCapture/slotPolicy";
import type { IdempotencyRequestOptions } from "@/shared/api/client";
import { createIdempotencyKey } from "@/shared/api/idempotency";
import type { CreateMatchDraftRequest, MatchDraftResponse } from "@/shared/api/matchDrafts";
import type {
  CreateOcrJobRequest,
  CreateOcrJobResponse,
  OcrJobHintsRequest,
} from "@/shared/api/ocrJobs";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import { parseOcrJobStatus } from "@/shared/domain/ocr";
import type { SlotKind } from "@/shared/domain/ocr";

export type OcrSubmissionResult =
  | { status: "empty" }
  | { message: string; status: "invalid" }
  | { error: unknown; status: "draft_create_failed" }
  | { matchDraftId: string; status: "submission_failed" }
  | { createdJobCount: number; failedJobCount: number; status: "started" | "partial_started" };

export type OcrSubmissionProgress =
  | { phase: "creating_draft"; total: number }
  | { current: number; phase: "submitting_image"; slotKind: SlotKind; total: number }
  | { completed: number; phase: "finalizing"; total: number };

/** Checkpoints belong to the immutable confirmation plan, including uncertain HTTP outcomes. */
export type OcrSubmissionState = {
  draftKey: string;
  draft?: MatchDraftResponse;
  slots: Partial<
    Record<
      SlotKind,
      {
        key: string;
        upload?: { imageId: string };
        job?: CreateOcrJobResponse;
      }
    >
  >;
};

export function createOcrSubmissionState(): OcrSubmissionState {
  return { draftKey: createIdempotencyKey(), slots: {} };
}

export type OcrSubmissionWorkflowParams = OcrSubmissionInput & {
  createDraft: (
    request: CreateMatchDraftRequest,
    options: IdempotencyRequestOptions,
  ) => Promise<MatchDraftResponse>;
  createJob: (
    request: CreateOcrJobRequest,
    options: IdempotencyRequestOptions,
  ) => Promise<CreateOcrJobResponse>;
  uploadImage: (file: File, options: IdempotencyRequestOptions) => Promise<{ imageId: string }>;
  hints: OcrJobHintsRequest;
  playedAt: string;
  state: OcrSubmissionState;
  onProgress?: ((progress: OcrSubmissionProgress) => void) | undefined;
  updateSlot: (slot: CaptureSlotState) => void;
};

export async function runOcrSubmissionWorkflow({
  createDraft,
  createJob,
  uploadImage,
  hints,
  playedAt,
  state,
  onProgress,
  selectedGameTitle,
  selectedHeldEvent,
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
  if (setup.heldEventId && selectedHeldEvent?.id !== setup.heldEventId) {
    return { message: "選択した開催を確認してください。", status: "invalid" };
  }
  onProgress?.({ phase: "creating_draft", total: targetSlots.length });

  let matchDraftId: string | null;
  try {
    const matchDraft =
      state.draft ??
      (await createDraft(
        {
          gameTitleId: setup.gameTitleId,
          ...(setup.heldEventId && setup.matchNoInEvent
            ? { heldEventId: setup.heldEventId, matchNoInEvent: setup.matchNoInEvent }
            : {}),
          ...(selectedGameTitle?.layoutFamily
            ? { layoutFamily: selectedGameTitle.layoutFamily }
            : {}),
          mapMasterId: setup.mapMasterId,
          ownerMemberId: setup.ownerMemberId,
          playedAt,
          seasonMasterId: setup.seasonMasterId,
          status: "ocr_running",
        },
        { idempotencyKey: state.draftKey },
      ));
    state.draft = matchDraft;
    matchDraftId = matchDraft.matchDraftId;
  } catch (error) {
    return { error, status: "draft_create_failed" };
  }
  if (!matchDraftId) {
    return { error: new Error("matchDraftId was not returned"), status: "draft_create_failed" };
  }

  let createdJobCount = 0;
  let failedJobCount = 0;
  for (const [index, slot] of targetSlots.entries()) {
    if (!slot.file) continue;
    onProgress?.({
      current: index + 1,
      phase: "submitting_image",
      slotKind: slot.kind,
      total: targetSlots.length,
    });
    const uploadingSlot = toUploadingSlot(slot);
    updateSlot(uploadingSlot);
    try {
      const checkpoint = (state.slots[slot.kind] ??= { key: createIdempotencyKey() });
      const options = { idempotencyKey: checkpoint.key };
      const upload = (checkpoint.upload ??= await uploadImage(slot.file, options));
      const job = (checkpoint.job ??= await createJob(
        ocrJobRequestForSlot(matchDraftId, slot, upload.imageId, hints),
        options,
      ));
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

  onProgress?.({
    completed: createdJobCount + failedJobCount,
    phase: "finalizing",
    total: targetSlots.length,
  });

  if (createdJobCount > 0) {
    return {
      createdJobCount,
      failedJobCount,
      status: failedJobCount > 0 ? "partial_started" : "started",
    };
  }

  // A lost response cannot prove that registration failed. Keep the same draft and keys
  // so an explicit retry can recover accepted writes without cancelling live work.
  return { matchDraftId, status: "submission_failed" };
}

export function ocrJobRequestForSlot(
  matchDraftId: string,
  slot: CaptureSlotState,
  imageId: string,
  hints: OcrJobHintsRequest,
) {
  return {
    imageId,
    matchDraftId,
    requestedScreenType: requestedScreenTypeForSlot(slot),
    ocrHints: hints,
  };
}
