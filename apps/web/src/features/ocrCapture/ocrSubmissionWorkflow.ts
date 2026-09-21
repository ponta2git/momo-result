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
  OcrJobResponse,
} from "@/shared/api/ocrJobs";
import type { OcrSubmissionResponse, PutOcrSubmissionRequest } from "@/shared/api/ocrSubmissions";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import { parseOcrJobStatus } from "@/shared/domain/ocr";
import type { SlotKind } from "@/shared/domain/ocr";

export type OcrSubmissionResult =
  | { status: "empty" }
  | { message: string; status: "invalid" }
  | { error: unknown; status: "draft_create_failed" }
  | { matchDraftId: string; status: "submission_failed" }
  | { canRestart: boolean; status: "submission_closed" }
  | { createdJobCount: number; failedJobCount: number; status: "started" | "partial_started" };

export type OcrSubmissionProgress =
  | { phase: "creating_draft"; total: number }
  | { current: number; phase: "submitting_image"; slotKind: SlotKind; total: number }
  | { completed: number; phase: "finalizing"; total: number };

/** Checkpoints belong to the immutable confirmation plan, including uncertain HTTP outcomes. */
export type OcrSubmissionState = {
  submissionId: string;
  draftKey: string;
  draft?: MatchDraftResponse;
  targetKinds?: SlotKind[];
  retryKinds?: SlotKind[];
  request?: PutOcrSubmissionRequest;
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
  return { submissionId: createIdempotencyKey(), draftKey: createIdempotencyKey(), slots: {} };
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
  putSubmission: (id: string, request: PutOcrSubmissionRequest) => Promise<OcrSubmissionResponse>;
  getJob: (id: string) => Promise<OcrJobResponse>;
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
  putSubmission,
  getJob,
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
  const targetSlots = pickOcrTargets(slots).filter(
    (slot) => !state.targetKinds || state.targetKinds.includes(slot.kind),
  );
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

  // Hash every selected image before the first write. Neither keys nor membership
  // may be allocated incrementally after the server starts processing images.
  let members: NonNullable<PutOcrSubmissionRequest["members"]>;
  try {
    members =
      state.request?.members ??
      (await Promise.all(
        targetSlots.map(async (slot) => {
          const file = slot.file;
          if (!file || file.size === 0 || file.size > 3 * 1024 * 1024)
            throw new Error("invalid image size");
          const checkpoint = (state.slots[slot.kind] ??= { key: createIdempotencyKey() });
          const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          return {
            screenType: requestedScreenTypeForSlot(slot),
            uploadIdempotencyKey: checkpoint.key,
            imageSha256: Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join(""),
            imageByteLength: file.size,
          };
        }),
      ));
  } catch {
    return {
      status: "invalid",
      message: "画像を読み込めませんでした。画像を選び直してお試しください。",
    };
  }

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

  let submission: OcrSubmissionResponse;
  try {
    state.request ??= { matchDraftId, ocrHints: hints, members };
    submission = await putSubmission(state.submissionId, state.request);
  } catch {
    return { matchDraftId, status: "submission_failed" };
  }
  const unregistered = targetSlots.filter((slot) =>
    submission.members?.some(
      (member) =>
        member.screenType === requestedScreenTypeForSlot(slot) && member.status === "failed",
    ),
  );
  if (
    submission.status === "aborted" ||
    (submission.status === "settled" && unregistered.length > 0)
  ) {
    state.retryKinds = submission.status === "settled" ? unregistered.map((slot) => slot.kind) : [];
    return { status: "submission_closed", canRestart: state.retryKinds.length > 0 };
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
      const accepted = submission.members?.find(
        (member) => member.screenType === requestedScreenTypeForSlot(slot),
      );
      if (accepted?.jobId && !checkpoint.job) {
        const recovered = await getJob(accepted.jobId);
        checkpoint.job = {
          jobId: recovered.jobId,
          draftId: recovered.draftId,
          status: recovered.status,
        };
      }
      if (accepted?.status === "failed") throw new Error("image admission closed");
      if (!checkpoint.job) {
        const upload = (checkpoint.upload ??= await uploadImage(slot.file, options));
        checkpoint.job = await createJob(
          ocrJobRequestForSlot(state.submissionId, slot, upload.imageId),
          options,
        );
      }
      const job = checkpoint.job;
      const status = parseOcrJobStatus(job.status);
      updateSlot({
        ...uploadingSlot,
        ...(checkpoint.upload ? { imageId: checkpoint.upload.imageId } : {}),
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
  submissionId: string,
  slot: CaptureSlotState,
  imageId: string,
) {
  return {
    imageId,
    submissionId,
    requestedScreenType: requestedScreenTypeForSlot(slot),
  };
}
