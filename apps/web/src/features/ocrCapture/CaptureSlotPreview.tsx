import { motion } from "motion/react";
import type { DragEventHandler } from "react";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { cn } from "@/shared/ui/cn";
import { momoPanelTransition } from "@/shared/ui/motion/variants";

const sourceLabels = {
  camera: "撮影",
  upload: "追加",
};

type CaptureSlotPreviewProps = {
  isCaptureTarget: boolean;
  isWorking: boolean;
  label: string;
  slot: CaptureSlotState;
  onDragStartCapture: DragEventHandler<HTMLDivElement>;
};

export function CaptureSlotPreview({
  isCaptureTarget,
  isWorking,
  label,
  slot,
  onDragStartCapture,
}: CaptureSlotPreviewProps) {
  const hasImage = Boolean(slot.previewUrl);

  if (!slot.previewUrl) {
    return (
      <div
        className={cn(
          "rounded-[var(--radius-sm)] border border-dashed bg-[var(--color-surface-subtle)] p-2",
          isCaptureTarget ? "border-[var(--color-action)]" : "border-[var(--color-border)]",
        )}
      >
        <div className="grid aspect-video place-items-center px-2 text-center text-xs text-[var(--color-text-secondary)]">
          <span>{isCaptureTarget ? "次に撮影されます" : `${label}の画像待ち`}</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      key={slot.previewUrl}
      animate={{ opacity: 1 }}
      className={cn(
        "rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--momo-night-900)] p-1.5",
        isWorking ? "cursor-not-allowed opacity-85" : "cursor-grab active:cursor-grabbing",
      )}
      draggable={hasImage && !isWorking}
      initial={{ opacity: 0 }}
      transition={momoPanelTransition}
      onDragStartCapture={onDragStartCapture}
    >
      <img
        src={slot.previewUrl}
        alt={`${label}プレビュー`}
        className="aspect-video w-full rounded-[var(--radius-sm)] object-contain"
      />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-1 text-[0.6875rem] text-white/80">
        <span>{slot.source ? `${sourceLabels[slot.source]}した画像` : "配置済み画像"}</span>
        <span>{isWorking ? "読み取り中は分類を固定" : "ドラッグして別の分類へ移動"}</span>
      </div>
    </motion.div>
  );
}
