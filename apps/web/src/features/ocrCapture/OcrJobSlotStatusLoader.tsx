import { useEffect, useEffectEvent } from "react";

import { detectedKindFromResponse } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { useOcrJobStatus } from "@/features/ocrCapture/useOcrJobStatus";
import type { SlotKind } from "@/shared/api/enums";
import { parseOcrJobStatus } from "@/shared/api/enums";
import { getOcrDraft } from "@/shared/api/ocrDrafts";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { OcrJobResponse } from "@/shared/api/ocrJobs";
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

function slotFromJobResponse(slot: CaptureSlotState, response: OcrJobResponse): CaptureSlotState {
  const status = parseOcrJobStatus(response.status);
  return {
    ...slot,
    status: status === "unknown" ? slot.status : status,
    detectedKind: detectedKindFromResponse(response.detectedScreenType),
    draftId: response.draftId,
    jobFailure: response.failure,
    statusRefreshPending: false,
    transportError: undefined,
  };
}

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

  const responseMatchesSlot = Boolean(query.data && slot.jobId && query.data.jobId === slot.jobId);
  const dataMarker =
    responseMatchesSlot && slot.jobId && query.dataUpdatedAt > 0
      ? `${slot.jobId}:${query.dataUpdatedAt}`
      : null;
  const draftLoadMarker =
    responseMatchesSlot &&
    slot.jobId &&
    query.data?.draftId &&
    parseOcrJobStatus(query.data.status) === "succeeded"
      ? `${slot.jobId}:${query.data.draftId}:${query.dataUpdatedAt}`
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
    const nextSlot = slotFromJobResponse(slot, query.data);
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
    }
  });

  const startDraftLoad = useEffectEvent(() => {
    if (!query.data || !slot.jobId || !query.data.draftId) {
      return;
    }

    const expected = {
      draftId: query.data.draftId,
      jobId: slot.jobId,
      kind: slot.kind,
    };
    const nextSlot = slotFromJobResponse(slot, query.data);
    const abortController = new AbortController();
    let active = true;

    async function loadDraft() {
      try {
        const draft = await getOcrDraft(expected.draftId, { signal: abortController.signal });
        if (!active || abortController.signal.aborted) {
          return;
        }
        if (draft.jobId !== expected.jobId || draft.draftId !== expected.draftId) {
          const error = normalizeDisplayApiError(
            new Error("OCR draft identity did not match the completed job."),
            "読み取り結果を取得できませんでした",
          );
          onUpdate({ ...nextSlot, status: "failed", transportError: error });
          onDraftLoadError?.(error);
          return;
        }
        onDraft(expected.kind, draft);
      } catch (loadError: unknown) {
        if (!active || abortController.signal.aborted) {
          return;
        }
        const error = normalizeDisplayApiError(loadError, "読み取り結果を取得できませんでした");
        onUpdate({ ...nextSlot, status: "failed", transportError: error });
        onDraftLoadError?.(error);
      }
    }

    void loadDraft();

    return () => {
      active = false;
      abortController.abort();
    };
  });

  useEffect(() => {
    if (!draftLoadMarker) {
      return;
    }
    return startDraftLoad();
  }, [draftLoadMarker]);

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
