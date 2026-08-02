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

  return (
    <motion.div
      key={slot.previewUrl ?? "empty"}
      aria-label={`${label}の16:9画像枠`}
      animate={{ opacity: 1 }}
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-[var(--radius-sm)] border",
        hasImage
          ? "border-[var(--color-border)] bg-[var(--momo-night-900)]"
          : "border-dashed bg-[var(--color-surface-subtle)]",
        isCaptureTarget && !hasImage
          ? "border-[var(--color-action)]"
          : "border-[var(--color-border)]",
        hasImage &&
          (isWorking ? "cursor-not-allowed opacity-85" : "cursor-grab active:cursor-grabbing"),
      )}
      draggable={hasImage && !isWorking}
      initial={{ opacity: 0 }}
      role="group"
      transition={momoPanelTransition}
      onDragStartCapture={onDragStartCapture}
    >
      {slot.previewUrl ? (
        <>
          <img
            src={slot.previewUrl}
            alt={`${label}プレビュー`}
            className="size-full object-contain"
          />
          {slot.source ? (
            <span className="absolute bottom-1.5 left-1.5 rounded-[var(--radius-sm)] border border-white/15 bg-[var(--momo-night-900)]/80 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white">
              {sourceLabels[slot.source]}
            </span>
          ) : null}
          <span className="sr-only">
            {isWorking ? "読み取り中は分類を固定" : "ドラッグして別の分類へ移動"}
          </span>
        </>
      ) : (
        <span className="absolute inset-0 grid place-items-center px-2 text-center text-xs text-pretty text-[var(--color-text-secondary)]">
          {isCaptureTarget ? "次に撮影されます" : `${label}の画像待ち`}
        </span>
      )}
    </motion.div>
  );
}
