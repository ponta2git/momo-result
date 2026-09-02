import { useCallback, useState } from "react";
import type { DragEventHandler } from "react";

import { CaptureSlotActions } from "@/features/ocrCapture/CaptureSlotActions";
import { CaptureSlotFeedback } from "@/features/ocrCapture/CaptureSlotFeedback";
import { CaptureSlotPreview } from "@/features/ocrCapture/CaptureSlotPreview";
import { CaptureStatusBadge } from "@/features/ocrCapture/CaptureSlotStatus";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { DraftPreview } from "@/features/ocrCapture/DraftPreview";
import { isWorkingStatus } from "@/features/ocrCapture/slotPolicy";
import type { SlotKind } from "@/shared/api/enums";
import { parseSlotKind } from "@/shared/api/enums";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import { cn } from "@/shared/ui/cn";

type CaptureSlotCardProps = {
  actions: CaptureSlotActionsModel;
  draft?: OcrDraftResponse | undefined;
  presentation: CaptureSlotPresentation;
  statusRefreshing: boolean;
  slot: CaptureSlotState;
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

export function CaptureSlotCard({
  actions,
  draft,
  presentation,
  statusRefreshing,
  slot,
}: CaptureSlotCardProps) {
  const mismatch = slot.detectedKind && slot.detectedKind !== slot.kind;
  const hasImage = Boolean(slot.previewUrl);
  const isWorking = isWorkingStatus(slot.status);
  const [dragOver, setDragOver] = useState(false);

  const handleDragStart = useCallback<DragEventHandler<HTMLDivElement>>(
    (event) => {
      if (!hasImage || isWorking) {
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", slot.kind);
    },
    [hasImage, isWorking, slot.kind],
  );

  const handleDragOver = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      if (isWorking) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragOver(true);
    },
    [isWorking],
  );

  const handleDrop = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      event.preventDefault();
      setDragOver(false);
      const sourceKind = parseSlotKind(event.dataTransfer.getData("text/plain"));
      if (sourceKind) {
        actions.onDropImage(sourceKind, slot.kind);
      }
    },
    [actions, slot.kind],
  );

  const handleMoveBackward = useCallback(() => actions.onMoveImage(-1), [actions]);
  const handleMoveForward = useCallback(() => actions.onMoveImage(1), [actions]);

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3",
        dragOver ? "border-[var(--color-action)] bg-[var(--color-action)]/10" : "",
      )}
      data-capture-target={presentation.captureTarget || undefined}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-6 w-1 shrink-0 rounded-full ${presentation.accentClass}`}
          />
          <div className="min-w-0">
            <h3 className="font-semibold text-[var(--color-text-primary)]">{presentation.label}</h3>
          </div>
        </div>
        <CaptureStatusBadge status={slot.status} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(8rem,10rem)_minmax(0,1fr)]">
        <CaptureSlotPreview
          isWorking={isWorking}
          label={presentation.label}
          slot={slot}
          onDragStartCapture={handleDragStart}
        />
        <CaptureSlotActions
          captureDisabled={isWorking}
          captureLabel={hasImage ? "撮り直し先にする" : "撮影先にする"}
          captureSelected={presentation.captureTarget}
          canMoveBackward={hasImage && !isWorking && presentation.index > 0}
          canMoveForward={hasImage && !isWorking && presentation.index < presentation.total - 1}
          clearDisabled={slot.status === "empty" || isWorking}
          moveBackwardLabel={presentation.previousLabel}
          moveForwardLabel={presentation.nextLabel}
          onClear={actions.onClear}
          onMoveBackward={handleMoveBackward}
          onMoveForward={handleMoveForward}
          onSelectCapture={actions.onSelectCapture}
        />
      </div>

      <div className="mt-4 grid gap-4 empty:hidden">
        <CaptureSlotFeedback
          mismatch={Boolean(mismatch)}
          refreshing={statusRefreshing}
          slot={slot}
          onRefreshStatus={actions.onRefreshStatus}
        />

        <DraftPreview draft={draft} />
      </div>
    </section>
  );
}
