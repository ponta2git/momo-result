import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { detectedKindFromResponse } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { useOcrJobStatus } from "@/features/ocrCapture/useOcrJobStatus";
import type { SlotKind } from "@/shared/api/enums";
import { parseOcrJobStatus } from "@/shared/api/enums";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { OcrJobResponse } from "@/shared/api/ocrJobs";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { ocrDraftDetailQueryOptions } from "@/shared/api/queryOptions";
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

function useOcrJobSlotSynchronization({
  onDraft,
  onDraftLoadError,
  onRefreshingChange,
  onUpdate,
  slot,
}: OcrJobSlotStatusLoaderProps): void {
  const job = useOcrJobStatus({
    jobId: slot.jobId,
    refreshRequest: slot.statusRefreshRequest,
  });
  const responseMatchesSlot = Boolean(job.data && slot.jobId && job.data.jobId === slot.jobId);
  const succeededJob =
    responseMatchesSlot && job.data && parseOcrJobStatus(job.data.status) === "succeeded"
      ? job.data
      : undefined;
  const expectedDraftId = succeededJob?.draftId;
  const draft = useQuery(ocrDraftDetailQueryOptions(expectedDraftId));
  const dataMarker =
    responseMatchesSlot && slot.jobId && job.dataUpdatedAt > 0
      ? `${slot.jobId}:${job.dataUpdatedAt}`
      : null;
  const draftDataMarker =
    succeededJob && expectedDraftId && draft.data && draft.dataUpdatedAt > 0
      ? `${succeededJob.jobId}:${expectedDraftId}:${job.dataUpdatedAt}:${draft.dataUpdatedAt}`
      : null;
  const draftErrorMarker =
    succeededJob && expectedDraftId && draft.error && draft.errorUpdatedAt > 0
      ? `${succeededJob.jobId}:${expectedDraftId}:${job.dataUpdatedAt}:${draft.errorUpdatedAt}`
      : null;
  const errorMarker =
    job.error && slot.jobId && job.errorUpdatedAt > 0
      ? `${slot.jobId}:${job.errorUpdatedAt}`
      : null;

  useEffect(() => {
    if (slot.jobId) onRefreshingChange(slot.kind, job.isFetching);
  }, [job.isFetching, onRefreshingChange, slot.jobId, slot.kind]);

  useDistinctMarkerEffect(dataMarker, () => {
    if (!job.data) return;

    const status = parseOcrJobStatus(job.data.status);
    const nextSlot = slotFromJobResponse(slot, job.data);
    onUpdate(nextSlot);
    if (status !== "succeeded" || job.data.draftId) return;

    const error = normalizeDisplayApiError(
      new Error("OCR draft id was not returned."),
      "読み取り結果を取得できませんでした",
    );
    onUpdate({ ...nextSlot, status: "failed", transportError: error });
    onDraftLoadError?.(error);
  });

  useDistinctMarkerEffect(draftDataMarker, () => {
    if (!succeededJob || !expectedDraftId || !draft.data || !slot.jobId) return;

    const nextSlot = slotFromJobResponse(slot, succeededJob);
    if (draft.data.jobId !== slot.jobId || draft.data.draftId !== expectedDraftId) {
      const error = normalizeDisplayApiError(
        new Error("OCR draft identity did not match the completed job."),
        "読み取り結果を取得できませんでした",
      );
      onUpdate({ ...nextSlot, status: "failed", transportError: error });
      onDraftLoadError?.(error);
      return;
    }
    onDraft(slot.kind, draft.data);
  });

  useDistinctMarkerEffect(draftErrorMarker, () => {
    if (!succeededJob || !draft.error) return;
    const error = normalizeDisplayApiError(draft.error, "読み取り結果を取得できませんでした");
    onUpdate({
      ...slotFromJobResponse(slot, succeededJob),
      status: "failed",
      transportError: error,
    });
    onDraftLoadError?.(error);
  });

  useDistinctMarkerEffect(errorMarker, () => {
    if (!job.error) return;
    onUpdate({
      ...slot,
      statusRefreshPending: false,
      transportError: normalizeDisplayApiError(job.error, "読み取り状態を取得できませんでした"),
    });
  });
}

/** Keeps one keyed capture slot synchronized without coupling the parent list to query hooks. */
export function OcrJobSlotStatusLoader(props: OcrJobSlotStatusLoaderProps) {
  useOcrJobSlotSynchronization(props);
  return null;
}
