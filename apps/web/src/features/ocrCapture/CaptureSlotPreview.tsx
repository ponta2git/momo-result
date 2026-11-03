import type { DragEventHandler } from "react";

import type { CaptureSlotView } from "@/features/ocrCapture/captureSlotView";
import { cn } from "@/shared/ui/cn";
import { compactBadgeClass } from "@/shared/ui/status/badgeRecipes";
import { contentText } from "@/shared/ui/typography";

const sourceLabels = {
  camera: "撮影",
  upload: "追加",
};

type CaptureSlotPreviewProps = {
  isWorking: boolean;
  label: string;
  slot: CaptureSlotView;
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
        "relative aspect-video w-full overflow-hidden rounded-sm border border-[var(--color-border)]",
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
            <span
              className={cn(
                compactBadgeClass,
                // Over the image a dark fill alone separates the label; no frame is needed.
                "absolute bottom-2 left-2 border-transparent bg-[var(--color-surface-inverse)]/80 text-[var(--color-text-inverse)]",
              )}
            >
              {sourceLabels[slot.source]}
            </span>
          ) : null}
          <span className="sr-only">
            {isWorking ? "読み取り中は分類を固定" : "ドラッグして別の分類へ移動"}
          </span>
        </>
      ) : (
        <span
          className={cn(
            contentText.supporting,
            "absolute inset-0 grid place-items-center px-2 text-center text-pretty",
          )}
        >
          {label}の画像待ち
        </span>
      )}
    </div>
  );
}
