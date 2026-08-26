import type { DragEventHandler } from "react";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { cn } from "@/shared/ui/cn";

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

  return (
    <div
      aria-label={`${label}の16:9画像枠`}
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]",
        hasImage
          ? "bg-[var(--color-media-canvas)]"
          : "border-dashed bg-[var(--color-surface-subtle)]",
        hasImage &&
          (isWorking ? "cursor-not-allowed opacity-85" : "cursor-grab active:cursor-grabbing"),
      )}
      draggable={hasImage && !isWorking}
      role="group"
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
            <span className="absolute bottom-2 left-2 rounded-[var(--radius-sm)] border border-[var(--color-text-inverse)]/15 bg-[var(--color-surface-inverse)]/80 px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--color-text-inverse)]">
              {sourceLabels[slot.source]}
            </span>
          ) : null}
          <span className="sr-only">
            {isWorking ? "読み取り中は分類を固定" : "ドラッグして別の分類へ移動"}
          </span>
        </>
      ) : (
        <span className="absolute inset-0 grid place-items-center px-2 text-center text-xs text-pretty text-[var(--color-text-secondary)]">
          {label}の画像待ち
        </span>
      )}
    </div>
  );
}
