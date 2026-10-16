import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { isWorkingStatus, pickOcrTargets } from "@/features/ocrCapture/slotPolicy";
import type { SlotKind } from "@/shared/domain/ocr";

export function ocrSlotLabels(slots: readonly CaptureSlotState[]): string[] {
  return slotDefinitions
    .filter((definition) => slots.some((slot) => slot.kind === definition.kind))
    .map((definition) => definition.label);
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

/** Derives capture controls and submission copy from the same slot policy used at submission. */
export function buildOcrCaptureView({
  slots,
  targetKind,
  locked,
  submitting,
  setupReady,
}: {
  slots: readonly CaptureSlotState[];
  targetKind: SlotKind;
  locked: boolean;
  submitting: boolean;
  setupReady: boolean;
}) {
  const target = slotDefinitions.find((definition) => definition.kind === targetKind);
  if (!target) throw new Error(`Unknown OCR capture target: ${targetKind}`);
  const targets = pickOcrTargets(slots);
  const labels = ocrSlotLabels(targets);
  const selectedImageCount = slots.filter((slot) => Boolean(slot.file)).length;
  const hasWorkingSlot = slots.some((slot) => isWorkingStatus(slot.status));
  const cameraDisabled = locked || hasWorkingSlot;
  return {
    camera: {
      actionVariant:
        selectedImageCount === slotDefinitions.length
          ? ("secondary" as const)
          : ("primary" as const),
      disabled: cameraDisabled,
      target: { label: target.label },
    },
    selectedImageCount,
    totalSlotCount: slotDefinitions.length,
    resetDisabled: selectedImageCount === 0 || cameraDisabled,
    start: {
      badgeLabel: targets.length === 0 ? "画像未選択" : `${targets.length}件を送信`,
      buttonLabel: targets.length === 0 ? "読み取りを開始" : `${targets.length}件で読み取りを開始`,
      description:
        labels.length > 0
          ? `${labels.join("・")}を読み取ります。${
              targets.length < slotDefinitions.length
                ? "未配置の分類は確認画面で手入力できます。"
                : "3種類すべて揃っています。"
            }`
          : "分類トレイを選び、まず1枚撮影してください。",
      disabled: locked || targets.length === 0 || hasWorkingSlot || submitting || !setupReady,
    },
  };
}
