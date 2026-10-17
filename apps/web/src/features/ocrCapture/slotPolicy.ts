import { createInitialSlot } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import type { OcrSlotReceipt } from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type { SlotKind } from "@/shared/domain/ocr";

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
    selectionId: slot.selectionId,
    file: slot.file,
    previewUrl: slot.previewUrl,
    status: "selected",
  };
}

export function captureSlotCapabilities(slot: CaptureSlotState) {
  const working = isWorkingStatus(slot.status);
  return {
    canSelect: !working,
    canDrop: !working,
    canMove: Boolean(slot.previewUrl) && !working,
    canClear: slot.status !== "empty" && !working,
    canRefresh: Boolean(slot.jobId) && (slot.status === "queued" || slot.status === "running"),
    working,
  };
}

export function resolveCaptureTargetChange(slots: readonly CaptureSlotState[], kind: SlotKind) {
  const slot = slots.find((candidate) => candidate.kind === kind);
  return slot && isWorkingStatus(slot.status)
    ? ({ kind: "blocked", message: "読み取り中の分類は撮影先に変更できません。" } as const)
    : ({ kind: "selected", target: kind } as const);
}

export function nextEmptyCaptureTarget(slots: readonly CaptureSlotState[], current: SlotKind) {
  return slots.find((slot) => slot.kind !== current && !slot.file && !isWorkingStatus(slot.status))
    ?.kind;
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
  };
}

export function applyOcrSlotReceipt(
  slot: CaptureSlotState,
  receipt: OcrSlotReceipt,
): CaptureSlotState {
  if (
    !receipt.selectionId ||
    slot.kind !== receipt.kind ||
    slot.selectionId !== receipt.selectionId
  )
    return slot;
  const uploading = toUploadingSlot(slot);
  switch (receipt.type) {
    case "uploading":
      return uploading;
    case "accepted":
      return {
        ...uploading,
        imageId: receipt.imageId,
        jobId: receipt.jobId,
        draftId: receipt.draftId,
        status: receipt.status,
      };
    case "failed":
      return { ...uploading, status: "failed", transportError: receipt.error };
  }
}
