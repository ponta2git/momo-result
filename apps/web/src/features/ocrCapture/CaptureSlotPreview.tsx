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
  isWorking: boolean;
  label: string;
  slot: CaptureSlotState;
  onDragStartCapture: DragEventHandler<HTMLDivElement>;
};

export function CaptureSlotPreview({
  isWorking,
  label,
  slot,
  onDragStartCapture,
}: CaptureSlotPreviewProps) {
  const hasImage = Boolean(slot.previewUrl);

  if (!slot.previewUrl) {
    return (
      <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2">
        <div className="grid aspect-video place-items-center px-4 text-center text-sm text-[var(--color-text-secondary)]">
          <span>{label}の画像をここへ配置</span>
        </div>
        <div className="mt-2 flex min-h-4 items-center justify-between gap-2 px-1 text-xs text-[var(--color-text-muted)]">
          <span>空き分類</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      key={slot.previewUrl}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--momo-night-900)] p-2",
        isWorking ? "cursor-not-allowed opacity-85" : "cursor-grab active:cursor-grabbing",
      )}
      draggable={hasImage && !isWorking}
      initial={{ opacity: 0, y: 4 }}
      transition={momoPanelTransition}
      onDragStartCapture={onDragStartCapture}
    >
      <img
        src={slot.previewUrl}
        alt={`${label}プレビュー`}
        className="aspect-video w-full rounded-[var(--radius-sm)] object-contain"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-white/80">
        <span>{slot.source ? `${sourceLabels[slot.source]}した画像` : "配置済み画像"}</span>
        <span>{isWorking ? "読み取り中は分類を固定" : "ドラッグして別の分類へ移動"}</span>
      </div>
    </motion.div>
  );
}
