import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import {
  ocrJobRequestForSlot,
  runOcrSubmissionWorkflow,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type {
  OcrSubmissionProgress,
  OcrSubmissionResult,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { invalidateAfterOcrSubmissionStarted } from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { cancelMatchDraft, createMatchDraft } from "@/shared/api/matchDrafts";
import { createOcrJob, uploadImage } from "@/shared/api/ocrJobs";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

export type OcrCaptureSubmitParams = {
  onProgress?: ((progress: OcrSubmissionProgress) => void) | undefined;
  selectedGameTitle: { id: string; layoutFamily?: string | null } | undefined;
  setup: SetupFormValues;
  slots: readonly CaptureSlotState[];
  updateSlot: (slot: CaptureSlotState) => void;
};

export type OcrCaptureMutations = {
  isSubmitting: boolean;
  status: ReturnType<typeof useMutation>["status"];
  submit: (params: OcrCaptureSubmitParams) => Promise<OcrSubmissionResult | undefined>;
};

/**
 * OCR 取り込み画面の「画像アップロード → OCR ジョブ作成」までの副作用を集約する。
 * 画像/設定の状態は呼び出し側 (Page) が引数で渡し、本フックは送信パイプラインと
 * matches キャッシュ無効化を担う。結果に応じた案内とナビゲーションは呼び出し側が行う。
 */
export function useOcrCaptureMutations(hints: Record<string, unknown>): OcrCaptureMutations {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const createPlayedAtIso = useCallback(() => new Date().toISOString(), []);
  const inFlightRef = useRef(false);
  const [isSubmittingWorkflow, setIsSubmittingWorkflow] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async ({
      matchDraftId,
      slot,
      file,
    }: {
      file: File;
      matchDraftId: string;
      slot: CaptureSlotState;
    }) => {
      const upload = await uploadImage(file);
      const request = ocrJobRequestForSlot(matchDraftId, slot, upload.imageId, hints);
      const job = await runIdempotentMutation(
        idempotencyKeys,
        "ocrCapture.createOcrJob",
        request,
        (options) => createOcrJob(request, options),
      );
      return { upload, job };
    },
  });

  const submit = useCallback(
    async ({ onProgress, selectedGameTitle, setup, slots, updateSlot }: OcrCaptureSubmitParams) => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      setIsSubmittingWorkflow(true);
      try {
        const result = await runOcrSubmissionWorkflow({
          cancelDraft: async (matchDraftId) => {
            const payload = { matchDraftId };
            return runIdempotentMutation(
              idempotencyKeys,
              "ocrCapture.cancelMatchDraft",
              payload,
              (options) => cancelMatchDraft(matchDraftId, options),
            );
          },
          createDraft: (request) =>
            runIdempotentMutation(
              idempotencyKeys,
              "ocrCapture.createMatchDraft",
              request,
              (options) => createMatchDraft(request, options),
            ),
          createPlayedAtIso,
          createUploadJob: ({ file, matchDraftId, slot }) =>
            uploadMutation.mutateAsync({ file, matchDraftId, slot }),
          onProgress,
          selectedGameTitle,
          setup,
          slots,
          updateSlot,
        });

        if (result.status === "started" || result.status === "partial_started") {
          await invalidateAfterOcrSubmissionStarted(queryClient);
        } else if (result.status === "failed_cleanup_failed") {
          await invalidateAfterOcrSubmissionStarted(queryClient);
        }
        return result;
      } finally {
        inFlightRef.current = false;
        setIsSubmittingWorkflow(false);
      }
    },
    [createPlayedAtIso, idempotencyKeys, queryClient, uploadMutation],
  );

  return {
    isSubmitting: isSubmittingWorkflow || uploadMutation.isPending,
    status: uploadMutation.status,
    submit,
  };
}
