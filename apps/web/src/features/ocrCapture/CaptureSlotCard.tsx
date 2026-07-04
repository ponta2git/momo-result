import { useCallback } from "react";
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

type CaptureSlotCardProps = {
  actions: CaptureSlotActionsModel;
  draft?: OcrDraftResponse | undefined;
  presentation: CaptureSlotPresentation;
  slot: CaptureSlotState;
};

type CaptureSlotActionsModel = {
  onClear: () => void;
  onDropImage: (sourceKind: SlotKind, targetKind: SlotKind) => void;
  onManualRefresh: () => void;
  onMoveImage: (direction: -1 | 1) => void;
};

type CaptureSlotPresentation = {
  accentClass: string;
  index: number;
  label: string;
  stationLabel: string;
  total: number;
};

export function CaptureSlotCard({ actions, draft, presentation, slot }: CaptureSlotCardProps) {
  const mismatch = slot.detectedKind && slot.detectedKind !== slot.kind;
  const hasImage = Boolean(slot.previewUrl);
  const isWorking = isWorkingStatus(slot.status);

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

  const handleDragOver = useCallback<DragEventHandler<HTMLElement>>((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      event.preventDefault();
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
      className="relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${presentation.accentClass}`} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full border border-[var(--color-tray-marker)]/35 bg-[var(--color-tray-marker)]/8 text-sm font-semibold text-[var(--color-tray-marker)]">
              {presentation.stationLabel}
            </span>
            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">分類</p>
              <h2 className="mt-0.5 text-lg font-semibold text-[var(--color-text-primary)]">
                {presentation.label}
              </h2>
            </div>
          </div>
          {hasImage ? (
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              読み取り分類: {presentation.label}
            </p>
          ) : null}
        </div>
        <CaptureStatusBadge status={slot.status} />
      </div>

      <CaptureSlotPreview
        isWorking={isWorking}
        label={presentation.label}
        slot={slot}
        onDragStartCapture={handleDragStart}
      />

      <CaptureSlotActions
        canMoveBackward={hasImage && !isWorking && presentation.index > 0}
        canMoveForward={hasImage && !isWorking && presentation.index < presentation.total - 1}
        clearDisabled={slot.status === "empty" || isWorking}
        onClear={actions.onClear}
        onMoveBackward={handleMoveBackward}
        onMoveForward={handleMoveForward}
      />

      <CaptureSlotFeedback
        mismatch={Boolean(mismatch)}
        slot={slot}
        onManualRefresh={actions.onManualRefresh}
      />

      <DraftPreview draft={draft} />
    </section>
  );
}
