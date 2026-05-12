import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import {
  cancelMatchDraft,
  createMatchDraft,
  createOcrJob,
  uploadImage,
} from "@/features/ocrCapture/api";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import {
  ocrJobRequestForSlot,
  runOcrSubmissionWorkflow,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { invalidateAfterOcrSubmissionStarted } from "@/shared/api/cacheInvalidation";
import { formatApiError } from "@/shared/api/problemDetails";

export type OcrCaptureSubmitParams = {
  notify: (message: string, tone?: "info" | "success" | "warning") => void;
  selectedGameTitle: { id: string; layoutFamily?: string | null } | undefined;
  setup: SetupFormValues;
  slots: readonly CaptureSlotState[];
  updateSlot: (slot: CaptureSlotState) => void;
};

export type OcrCaptureMutations = {
  isSubmitting: boolean;
  status: ReturnType<typeof useMutation>["status"];
  submit: (params: OcrCaptureSubmitParams) => Promise<void>;
};

/**
 * OCR 取り込み画面の「画像アップロード → OCR ジョブ作成 → 試合一覧へ遷移」までの副作用を集約する。
 * 画像/設定の状態は呼び出し側 (Page) が引数で渡し、本フックは送信パイプラインと
 * matches キャッシュ無効化、ナビゲーションだけを担う。
 */
export function useOcrCaptureMutations(hints: Record<string, unknown>): OcrCaptureMutations {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
      const job = await createOcrJob(
        ocrJobRequestForSlot(matchDraftId, slot, upload.imageId, hints),
      );
      return { upload, job };
    },
  });

  const submit = useCallback(
    async ({ notify, selectedGameTitle, setup, slots, updateSlot }: OcrCaptureSubmitParams) => {
      const result = await runOcrSubmissionWorkflow({
        cancelDraft: cancelMatchDraft,
        createDraft: createMatchDraft,
        createUploadJob: ({ file, matchDraftId, slot }) =>
          uploadMutation.mutateAsync({ file, matchDraftId, slot }),
        onReady: (targetCount) =>
          notify(
            `${targetCount}件の読み取りを開始します。確定前の記録を作成し、試合一覧で処理状況を確認できるようにします。`,
          ),
        selectedGameTitle,
        setup,
        slots,
        updateSlot,
      });

      if (result.status === "empty") {
        notify("読み取る画像がありません。まず撮影または画像追加を行ってください。");
        return;
      }
      if (result.status === "invalid") {
        notify(result.message);
        return;
      }
      if (result.status === "draft_create_failed") {
        notify(formatApiError(result.error, "確定前の記録を作成できませんでした"));
        return;
      }
      if (result.status === "started" || result.status === "partial_started") {
        await invalidateAfterOcrSubmissionStarted(queryClient);
        if (result.status === "partial_started") {
          notify(
            `${result.createdJobCount}件の読み取りを開始しました。一部の画像は開始できなかったため、確認画面で手入力してください。`,
            "warning",
          );
        }
        navigate("/matches", { replace: true });
        return;
      }
      if (result.status === "failed_cleanup_failed") {
        await invalidateAfterOcrSubmissionStarted(queryClient);
        notify(
          formatApiError(
            result.cleanupError,
            "読み取り処理を開始できず、確定前の記録の取り消しにも失敗しました。試合一覧で状態を確認してください",
          ),
          "warning",
        );
        return;
      }

      notify("読み取り処理を開始できませんでした。確定前の記録は取り消しました。");
    },
    [navigate, queryClient, uploadMutation],
  );

  return {
    isSubmitting: uploadMutation.isPending,
    status: uploadMutation.status,
    submit,
  };
}
