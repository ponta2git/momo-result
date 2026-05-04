import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { invalidateMatchAndDraftCaches } from "@/features/matches/queryKeys";
import {
  cancelMatchDraft,
  createMatchDraft,
  createOcrJob,
  uploadImage,
} from "@/features/ocrCapture/api";
import { requestedImageTypeForSlot } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { pickOcrTargets, toUploadingSlot } from "@/features/ocrCapture/slotPolicy";
import { setupSchema } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { parseOcrJobStatus } from "@/shared/api/enums";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";

export type OcrCaptureSubmitParams = {
  notify: (message: string) => void;
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
export function useOcrCaptureMutations(
  hints: Record<string, unknown>,
): OcrCaptureMutations {
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
      const job = await createOcrJob({
        imageId: upload.imageId,
        matchDraftId,
        requestedImageType: requestedImageTypeForSlot(slot),
        ocrHints: hints,
      });
      return { upload, job };
    },
  });

  const submit = useCallback(
    async ({
      notify,
      selectedGameTitle,
      setup,
      slots,
      updateSlot,
    }: OcrCaptureSubmitParams) => {
      const targetSlots = pickOcrTargets(slots);
      if (targetSlots.length === 0) {
        notify("OCRに送る画像がありません。まず撮影して分類トレイへ置いてください。");
        return;
      }
      const setupSubmission = setupSchema.safeParse(setup);
      if (!setupSubmission.success) {
        notify(setupSubmission.error.issues[0]?.message ?? "試合コンテキストを確認してください。");
        return;
      }

      notify(
        `${targetSlots.length}枚をOCRに送信しています。作業単位を作成して、試合一覧でOCR中として追跡します。`,
      );

      let matchDraftId: string | null;
      try {
        const matchDraft = await createMatchDraft({
          gameTitleId: setup.gameTitleId,
          ...(selectedGameTitle?.layoutFamily
            ? { layoutFamily: selectedGameTitle.layoutFamily }
            : {}),
          mapMasterId: setup.mapMasterId,
          ownerMemberId: setup.ownerMemberId,
          playedAt: new Date().toISOString(),
          seasonMasterId: setup.seasonMasterId,
          status: "ocr_running",
        });
        matchDraftId = matchDraft.matchDraftId;
      } catch (error) {
        notify(formatApiError(error, "対局の作成に失敗しました"));
        return;
      }
      if (!matchDraftId) return;

      let createdJobCount = 0;
      for (const slot of targetSlots) {
        if (!slot.file) continue;
        const uploadingSlot = toUploadingSlot(slot);
        updateSlot(uploadingSlot);
        try {
          const { upload, job } = await uploadMutation.mutateAsync({
            matchDraftId,
            slot: uploadingSlot,
            file: slot.file,
          });
          const status = parseOcrJobStatus(job.status);
          updateSlot({
            ...uploadingSlot,
            imageId: upload.imageId,
            jobId: job.jobId,
            draftId: job.draftId,
            status: status === "unknown" ? "queued" : status,
          });
          createdJobCount += 1;
        } catch (error) {
          updateSlot({
            ...uploadingSlot,
            status: "failed",
            transportError: normalizeUnknownApiError(error),
          });
        }
      }

      if (createdJobCount > 0) {
        await invalidateMatchAndDraftCaches(queryClient);
        navigate("/matches", { replace: true });
        return;
      }

      void cancelMatchDraft(matchDraftId).catch(() => undefined);
      notify("OCRジョブを作成できませんでした。画像と試合コンテキストを確認してください。");
    },
    [navigate, queryClient, uploadMutation],
  );

  return {
    isSubmitting: uploadMutation.isPending,
    status: uploadMutation.status,
    submit,
  };
}
