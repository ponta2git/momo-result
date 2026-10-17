import { useId, useState } from "react";
import type { DragEventHandler } from "react";

import { CaptureSlotActions } from "@/features/ocrCapture/CaptureSlotActions";
import { CaptureSlotFeedback } from "@/features/ocrCapture/CaptureSlotFeedback";
import { CaptureSlotPreview } from "@/features/ocrCapture/CaptureSlotPreview";
import { CaptureStatusBadge } from "@/features/ocrCapture/CaptureSlotStatus";
import type { CaptureSlotView } from "@/features/ocrCapture/captureSlotView";
import { DraftPreview } from "@/features/ocrCapture/DraftPreview";
import type { SlotKind } from "@/shared/domain/ocr";
import { parseSlotKind } from "@/shared/domain/ocr";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

type CaptureSlotCardProps = {
  actions: CaptureSlotActionsModel;
  presentation: CaptureSlotPresentation;
  slot: CaptureSlotView;
};

type CaptureSlotActionsModel = {
  onClear: () => void;
  onDropImage: (sourceKind: SlotKind, targetKind: SlotKind) => void;
  onRefreshStatus: () => void;
  onMoveImage: (direction: -1 | 1) => void;
  onSelectCapture: () => void;
};

type CaptureSlotPresentation = {
  accentClass: string;
  index: number;
  label: string;
  nextLabel?: string | undefined;
  previousLabel?: string | undefined;
  total: number;
  captureTarget: boolean;
};

export function CaptureSlotCard({ actions, presentation, slot }: CaptureSlotCardProps) {
  const headingId = useId();
  const { capabilities } = slot;
  const hasImage = Boolean(slot.previewUrl);
  const isWorking = capabilities.working;
  const [dragOver, setDragOver] = useState(false);

  const handleDragStart: DragEventHandler<HTMLDivElement> = (event) => {
    if (!capabilities.canMove) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", slot.kind);
  };

  const handleDragOver: DragEventHandler<HTMLElement> = (event) => {
    if (!capabilities.canDrop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOver(true);
  };

  const handleDrop: DragEventHandler<HTMLElement> = (event) => {
    event.preventDefault();
    setDragOver(false);
    if (!capabilities.canDrop) return;
    const sourceKind = parseSlotKind(event.dataTransfer.getData("text/plain"));
    if (sourceKind) actions.onDropImage(sourceKind, slot.kind);
  };

  return (
    // Labeled move buttons provide the keyboard equivalent of this optional drop target.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      aria-labelledby={headingId}
      className={cn(
        "relative grid gap-4 overflow-hidden rounded-md border p-4",
        presentation.captureTarget
          ? "border-[var(--color-action)] bg-[var(--color-surface-selected)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]",
        dragOver ? "border-[var(--color-action)] bg-[var(--color-action)]/10" : "",
      )}
      data-capture-target={presentation.captureTarget || undefined}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-6 w-1 shrink-0 rounded-full ${presentation.accentClass}`}
          />
          <div className="min-w-0">
            <h3 className={contentText.heading} id={headingId}>
              {presentation.label}
            </h3>
          </div>
        </div>
        <CaptureStatusBadge status={slot.status} />
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(8rem,10rem)_minmax(0,1fr)]">
        <CaptureSlotPreview
          isWorking={isWorking}
          label={presentation.label}
          slot={slot}
          onDragStartCapture={handleDragStart}
        />
        <CaptureSlotActions
          captureDisabled={!capabilities.canSelect}
          captureLabel={hasImage ? "撮り直し先にする" : "撮影先にする"}
          captureSelected={presentation.captureTarget}
          canMoveBackward={capabilities.canMove && presentation.index > 0}
          canMoveForward={capabilities.canMove && presentation.index < presentation.total - 1}
          clearDisabled={!capabilities.canClear}
          moveBackwardLabel={presentation.previousLabel}
          moveForwardLabel={presentation.nextLabel}
          onClear={actions.onClear}
          onMoveBackward={() => actions.onMoveImage(-1)}
          onMoveForward={() => actions.onMoveImage(1)}
          onSelectCapture={actions.onSelectCapture}
        />
      </div>

      <div className="grid gap-4 empty:hidden">
        <CaptureSlotFeedback
          mismatch={slot.mismatch}
          refreshing={slot.refreshing}
          slot={slot}
          onRefreshStatus={actions.onRefreshStatus}
        />

        <DraftPreview draft={slot.draft} />
      </div>
    </section>
  );
}
