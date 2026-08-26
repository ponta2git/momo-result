import { useEffect } from "react";

import { detectedKindFromResponse } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { useOcrJobStatus } from "@/features/ocrCapture/useOcrJobStatus";
import type { SlotKind } from "@/shared/api/enums";
import { parseOcrJobStatus } from "@/shared/api/enums";
import { getOcrDraft } from "@/shared/api/ocrDrafts";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { useDistinctMarkerEffect } from "@/shared/lib/useDistinctMarkerEffect";

type OcrJobSlotStatusLoaderProps = {
  onDraft: (kind: SlotKind, draft: OcrDraftResponse) => void;
  onDraftLoadError?: ((error: NormalizedApiError) => void) | undefined;
  onRefreshingChange: (kind: SlotKind, refreshing: boolean) => void;
  onUpdate: (slot: CaptureSlotState) => void;
  slot: CaptureSlotState;
};

export function OcrJobSlotStatusLoader({
  onDraft,
  onDraftLoadError,
  onRefreshingChange,
  onUpdate,
  slot,
}: OcrJobSlotStatusLoaderProps) {
  const query = useOcrJobStatus({
    jobId: slot.jobId,
    refreshRequest: slot.statusRefreshRequest,
  });

  const dataMarker =
    query.data && slot.jobId && query.dataUpdatedAt > 0
      ? `${slot.jobId}:${query.dataUpdatedAt}`
      : null;
  const errorMarker =
    query.error && slot.jobId && query.errorUpdatedAt > 0
      ? `${slot.jobId}:${query.errorUpdatedAt}`
      : null;

  useEffect(() => {
    if (slot.jobId) {
      onRefreshingChange(slot.kind, query.isFetching);
    }
  }, [onRefreshingChange, query.isFetching, slot.jobId, slot.kind]);

  useDistinctMarkerEffect(dataMarker, () => {
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
      statusRefreshPending: false,
      transportError: undefined,
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

  useDistinctMarkerEffect(errorMarker, () => {
    if (!query.error) {
      return;
    }
    onUpdate({
      ...slot,
      statusRefreshPending: false,
      transportError: normalizeDisplayApiError(query.error, "読み取り状態を取得できませんでした"),
    });
  });

  return null;
}
