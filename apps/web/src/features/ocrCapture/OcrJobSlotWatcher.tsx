import { detectedKindFromResponse } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { useOcrJobPolling } from "@/features/ocrCapture/useOcrJobPolling";
import type { SlotKind } from "@/shared/api/enums";
import { parseOcrJobStatus } from "@/shared/api/enums";
import { getOcrDraft } from "@/shared/api/ocrDrafts";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { useDistinctMarkerEffect } from "@/shared/lib/useDistinctMarkerEffect";

type OcrJobSlotWatcherProps = {
  onDraft: (kind: SlotKind, draft: OcrDraftResponse) => void;
  onDraftLoadError?: ((error: NormalizedApiError) => void) | undefined;
  onUpdate: (slot: CaptureSlotState) => void;
  slot: CaptureSlotState;
};

export function OcrJobSlotWatcher({
  onDraft,
  onDraftLoadError,
  onUpdate,
  slot,
}: OcrJobSlotWatcherProps) {
  const query = useOcrJobPolling({ jobId: slot.jobId, attempts: slot.pollAttempts });

  const marker =
    query.data && slot.jobId
      ? `${slot.jobId}:${query.data.status}:${query.data.updatedAt}:${query.data.draftId ?? ""}`
      : null;

  useDistinctMarkerEffect(marker, () => {
    if (!query.data) {
      return;
    }

    const status = parseOcrJobStatus(query.data.status);
    const nextStatus = status === "unknown" ? slot.status : status;
    const nextSlot = {
      ...slot,
      status: nextStatus,
      detectedKind: detectedKindFromResponse(query.data.detectedScreenType),
      draftId: query.data.draftId,
      jobFailure: query.data.failure,
      pollAttempts: slot.pollAttempts + 1,
    };
    onUpdate(nextSlot);

    if (status !== "succeeded") {
      return;
    }

    if (!query.data.draftId) {
      const error = normalizeDisplayApiError(
        new Error("OCR draft id was not returned."),
        "読み取り結果を取得できませんでした",
      );
      onUpdate({ ...nextSlot, status: "failed", transportError: error });
      onDraftLoadError?.(error);
      return;
    }

    void getOcrDraft(query.data.draftId)
      .then((draft) => onDraft(slot.kind, draft))
      .catch((loadError: unknown) => {
        const error = normalizeDisplayApiError(loadError, "読み取り結果を取得できませんでした");
        onUpdate({ ...nextSlot, status: "failed", transportError: error });
        onDraftLoadError?.(error);
      });
  });

  return null;
}
