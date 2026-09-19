import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import type { OcrSubmissionPlan } from "@/features/ocrCapture/ocrSubmissionPlan";
import {
  createOcrSubmissionState,
  runOcrSubmissionWorkflow,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type {
  OcrSubmissionState,
  OcrSubmissionResult,
  OcrSubmissionWorkflowParams,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import { invalidateAfterOcrSubmissionStarted } from "@/shared/api/cacheInvalidation";
import { createMatchDraft } from "@/shared/api/matchDrafts";
import { createOcrJob, uploadImage } from "@/shared/api/ocrJobs";

export type OcrCaptureSubmitParams = Pick<
  OcrSubmissionWorkflowParams,
  "onProgress" | "updateSlot"
> & {
  plan: OcrSubmissionPlan;
};

export type OcrCaptureMutations = {
  isSubmitting: boolean;
  submit: (params: OcrCaptureSubmitParams) => Promise<OcrSubmissionResult | undefined>;
};

/** One mutation owns the entire draft/upload/job workflow, including cache reconciliation. */
export function useOcrCaptureMutations(): OcrCaptureMutations {
  const queryClient = useQueryClient();
  const checkpoints = useRef(new WeakMap<OcrSubmissionPlan, OcrSubmissionState>());
  const inFlightRef = useRef(false);
  const submission = useMutation({
    mutationFn: ({ plan, ...params }: OcrCaptureSubmitParams) => {
      const state = checkpoints.current.get(plan) ?? createOcrSubmissionState();
      checkpoints.current.set(plan, state);
      return runOcrSubmissionWorkflow({
        ...plan,
        ...params,
        state,
        createDraft: createMatchDraft,
        uploadImage,
        createJob: createOcrJob,
      });
    },
    onSuccess: async (result) => {
      if (
        result.status === "started" ||
        result.status === "partial_started" ||
        result.status === "submission_failed"
      ) {
        await invalidateAfterOcrSubmissionStarted(queryClient).catch(() => undefined);
      }
    },
  });

  return {
    isSubmitting: submission.isPending,
    submit: async (params) => {
      // Guard synchronous repeat clicks before the pending render commits.
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        return await submission.mutateAsync(params);
      } finally {
        inFlightRef.current = false;
      }
    },
  };
}
