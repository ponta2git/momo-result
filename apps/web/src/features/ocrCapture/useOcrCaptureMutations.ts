import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import {
  ocrJobRequestForSlot,
  runOcrSubmissionWorkflow,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type {
  OcrSubmissionResult,
  OcrSubmissionWorkflowParams,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import { invalidateAfterOcrSubmissionStarted } from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { cancelMatchDraft, createMatchDraft } from "@/shared/api/matchDrafts";
import { createOcrJob, uploadImage } from "@/shared/api/ocrJobs";
import type { OcrJobHintsRequest } from "@/shared/api/ocrJobs";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

export type OcrCaptureSubmitParams = Pick<
  OcrSubmissionWorkflowParams,
  "onProgress" | "selectedGameTitle" | "selectedHeldEvent" | "setup" | "slots" | "updateSlot"
> & { hints: OcrJobHintsRequest };

export type OcrCaptureMutations = {
  isSubmitting: boolean;
  submit: (params: OcrCaptureSubmitParams) => Promise<OcrSubmissionResult | undefined>;
};

/** One mutation owns the entire draft/upload/job workflow, including cache reconciliation. */
export function useOcrCaptureMutations(): OcrCaptureMutations {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const inFlightRef = useRef(false);
  const submission = useMutation({
    mutationFn: ({ hints, ...params }: OcrCaptureSubmitParams) =>
      runOcrSubmissionWorkflow({
        ...params,
        cancelDraft: (matchDraftId) =>
          runIdempotentMutation(
            idempotencyKeys,
            "ocrCapture.cancelMatchDraft",
            { matchDraftId },
            (options) => cancelMatchDraft(matchDraftId, options),
          ),
        createDraft: (request) =>
          runIdempotentMutation(
            idempotencyKeys,
            "ocrCapture.createMatchDraft",
            request,
            (options) => createMatchDraft(request, options),
          ),
        createPlayedAtIso: () => new Date().toISOString(),
        createUploadJob: async ({ file, matchDraftId, slot }) => {
          const attempt = idempotencyKeys.begin("ocrCapture.createUploadJob", {
            file: {
              lastModified: file.lastModified,
              name: file.name,
              size: file.size,
              type: file.type,
            },
            matchDraftId,
            slotKind: slot.kind,
          });
          const options = { idempotencyKey: attempt.key };
          const upload = await uploadImage(file, options);
          const job = await createOcrJob(
            ocrJobRequestForSlot(matchDraftId, slot, upload.imageId, hints),
            options,
          );
          attempt.complete();
          return { upload, job };
        },
      }),
    onSuccess: async (result) => {
      if (
        result.status === "started" ||
        result.status === "partial_started" ||
        result.status === "failed_cleanup_failed"
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
