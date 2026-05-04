import { createInitialSlot } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";

/** OCR 送信中とみなすスロット状態。 */
export function isWorkingStatus(status: CaptureSlotState["status"]): boolean {
  return ["uploading", "queueing", "queued", "running"].includes(status);
}

/** 画像と previewUrl のみを引き継ぎ、ジョブ系の状態を捨てた選択済みスロットを返す。 */
export function keepImageOnly(slot: CaptureSlotState): CaptureSlotState {
  if (!slot.file || !slot.previewUrl) {
    return createInitialSlot(slot.kind);
  }
  return {
    ...createInitialSlot(slot.kind),
    source: slot.source,
    file: slot.file,
    previewUrl: slot.previewUrl,
    status: "selected",
  };
}

/** OCR ジョブ送信対象とみなすスロット（画像があり、未送信または再試行可能なもの）を抽出する。 */
export function pickOcrTargets(slots: readonly CaptureSlotState[]): CaptureSlotState[] {
  return slots.filter(
    (slot) => slot.file && ["selected", "failed", "cancelled"].includes(slot.status),
  );
}

/** 送信開始時のスロット状態（前回までのエラー/ジョブ情報を全部クリアしつつ画像は維持）。 */
export function toUploadingSlot(slot: CaptureSlotState): CaptureSlotState {
  return {
    ...slot,
    status: "uploading",
    transportError: undefined,
    jobFailure: undefined,
    detectedKind: undefined,
    imageId: undefined,
    jobId: undefined,
    draftId: undefined,
    pollAttempts: 0,
  };
}
