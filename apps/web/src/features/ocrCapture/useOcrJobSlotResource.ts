import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from "react";

import { detectedKindFromResponse } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { useOcrJobStatus } from "@/features/ocrCapture/useOcrJobStatus";
import { parseOcrJobStatus } from "@/shared/api/enums";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { OcrJobResponse } from "@/shared/api/ocrJobs";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { ocrDraftDetailQueryOptions } from "@/shared/api/queryOptions";

type OcrJobSlotResourceResolution = {
  draft: OcrDraftResponse | undefined;
  draftLoadError: NormalizedApiError | undefined;
  draftLoadErrorKey: string | undefined;
  slot: CaptureSlotState;
};

export type OcrJobSlotResource = {
  draft: OcrDraftResponse | undefined;
  refresh: () => void;
  refreshing: boolean;
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
    transportError: undefined,
  };
}

function draftLoadFailure(
  slot: CaptureSlotState,
  cause: unknown,
  draftLoadErrorKey: string,
): OcrJobSlotResourceResolution {
  const error = normalizeDisplayApiError(cause, "読み取り結果を取得できませんでした");
  return {
    draft: undefined,
    draftLoadError: error,
    draftLoadErrorKey,
    slot: { ...slot, status: "failed", transportError: error },
  };
}

function resolveOcrJobSlotResource({
  draftData,
  draftDataUpdatedAt,
  draftError,
  draftErrorUpdatedAt,
  jobData,
  jobDataUpdatedAt,
  jobError,
  jobFetching,
  slot,
}: {
  draftData: OcrDraftResponse | undefined;
  draftDataUpdatedAt: number;
  draftError: Error | null;
  draftErrorUpdatedAt: number;
  jobData: OcrJobResponse | undefined;
  jobDataUpdatedAt: number;
  jobError: Error | null;
  jobFetching: boolean;
  slot: CaptureSlotState;
}): OcrJobSlotResourceResolution {
  const matchingJob = jobData?.jobId === slot.jobId ? jobData : undefined;
  const jobSlot = matchingJob ? slotFromJobResponse(slot, matchingJob) : slot;

  if (jobError && !jobFetching) {
    return {
      draft: undefined,
      draftLoadError: undefined,
      draftLoadErrorKey: undefined,
      slot: {
        ...jobSlot,
        transportError: normalizeDisplayApiError(jobError, "読み取り状態を取得できませんでした"),
      },
    };
  }
  if (!matchingJob || parseOcrJobStatus(matchingJob.status) !== "succeeded") {
    return {
      draft: undefined,
      draftLoadError: undefined,
      draftLoadErrorKey: undefined,
      slot: jobSlot,
    };
  }
  const jobEventKey = `${slot.kind}:${matchingJob.jobId}:${jobDataUpdatedAt}`;
  if (!matchingJob.draftId) {
    return draftLoadFailure(
      jobSlot,
      new Error("OCR draft id was not returned."),
      `${jobEventKey}:missing-draft-id`,
    );
  }
  if (draftError) {
    return draftLoadFailure(
      jobSlot,
      draftError,
      `${jobEventKey}:${matchingJob.draftId}:${draftErrorUpdatedAt}:draft-error`,
    );
  }
  if (!draftData) {
    return {
      draft: undefined,
      draftLoadError: undefined,
      draftLoadErrorKey: undefined,
      slot: jobSlot,
    };
  }
  if (draftData.jobId !== slot.jobId || draftData.draftId !== matchingJob.draftId) {
    return draftLoadFailure(
      jobSlot,
      new Error("OCR draft identity did not match the completed job."),
      `${jobEventKey}:${matchingJob.draftId}:${draftDataUpdatedAt}:draft-identity`,
    );
  }
  return {
    draft: draftData,
    draftLoadError: undefined,
    draftLoadErrorKey: undefined,
    slot: jobSlot,
  };
}

/** Owns one slot's job/draft cache lifecycle and exposes a display-ready resource. */
export function useOcrJobSlotResource(
  slot: CaptureSlotState,
  onDraftLoadError?: ((error: NormalizedApiError) => void) | undefined,
): OcrJobSlotResource {
  const job = useOcrJobStatus({ jobId: slot.jobId });
  const matchingJob = job.data?.jobId === slot.jobId ? job.data : undefined;
  const expectedDraftId =
    matchingJob && parseOcrJobStatus(matchingJob.status) === "succeeded"
      ? matchingJob.draftId
      : undefined;
  const draft = useQuery(ocrDraftDetailQueryOptions(expectedDraftId));
  const resolution = useMemo(
    () =>
      resolveOcrJobSlotResource({
        draftData: draft.data,
        draftDataUpdatedAt: draft.dataUpdatedAt,
        draftError: draft.error,
        draftErrorUpdatedAt: draft.errorUpdatedAt,
        jobData: job.data,
        jobDataUpdatedAt: job.dataUpdatedAt,
        jobError: job.error,
        jobFetching: job.isFetching,
        slot,
      }),
    [
      draft.data,
      draft.dataUpdatedAt,
      draft.error,
      draft.errorUpdatedAt,
      job.data,
      job.dataUpdatedAt,
      job.error,
      job.isFetching,
      slot,
    ],
  );
  const reportDraftLoadError = useEffectEvent((error: NormalizedApiError) => {
    onDraftLoadError?.(error);
  });

  const lastReportedDraftErrorRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      !resolution.draftLoadError ||
      !resolution.draftLoadErrorKey ||
      lastReportedDraftErrorRef.current === resolution.draftLoadErrorKey
    ) {
      return;
    }
    lastReportedDraftErrorRef.current = resolution.draftLoadErrorKey;
    reportDraftLoadError(resolution.draftLoadError);
  }, [resolution.draftLoadError, resolution.draftLoadErrorKey]);

  const manualRefreshPendingRef = useRef(false);
  const refetch = job.refetch;
  const refresh = useCallback(() => {
    if (!slot.jobId || job.isFetching || manualRefreshPendingRef.current) return;

    manualRefreshPendingRef.current = true;
    void refetch().finally(() => {
      manualRefreshPendingRef.current = false;
    });
  }, [job.isFetching, refetch, slot.jobId]);

  return {
    draft: resolution.draft,
    refresh,
    refreshing: Boolean(slot.jobId && job.isFetching),
    slot: resolution.slot,
  };
}
