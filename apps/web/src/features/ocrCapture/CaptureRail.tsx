import { CaptureSlotCard } from "@/features/ocrCapture/CaptureSlotCard";
import type { CaptureSlotView } from "@/features/ocrCapture/captureSlotView";
import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { SlotKind } from "@/shared/domain/ocr";
import { cn } from "@/shared/ui/cn";

type CaptureRailProps = {
  captureTargetKind: SlotKind;
  layout?: "rail" | "stack";
  slots: readonly CaptureSlotView[];
  onClear: (kind: SlotKind) => void;
  onDropImage: (sourceKind: SlotKind, targetKind: SlotKind) => void;
  onMoveImage: (kind: SlotKind, direction: -1 | 1) => void;
  onRefreshStatus: (kind: SlotKind) => void;
  onSelectCaptureTarget: (kind: SlotKind) => void;
};

export function CaptureRail({
  captureTargetKind,
  layout = "rail",
  slots,
  onClear,
  onDropImage,
  onMoveImage,
  onRefreshStatus,
  onSelectCaptureTarget,
}: CaptureRailProps) {
  return (
    <section
      className={cn("grid gap-4", layout === "rail" ? "xl:grid-cols-3" : "")}
      aria-label="画像取り込み"
    >
      {slotDefinitions.map((definition, index) => {
        const slot = slots.find((candidate) => candidate.kind === definition.kind);
        if (!slot) {
          return null;
        }
        return (
          <CaptureRailSlot
            key={definition.kind}
            slot={slot}
            index={index}
            captureTarget={definition.kind === captureTargetKind}
            onClear={onClear}
            onDropImage={onDropImage}
            onMoveImage={onMoveImage}
            onRefreshStatus={onRefreshStatus}
            onSelectCaptureTarget={onSelectCaptureTarget}
          />
        );
      })}
    </section>
  );
}
import { memo } from "react";

const CaptureRailSlot = memo(function CaptureRailSlot({
  slot,
  index,
  captureTarget,
  onClear,
  onDropImage,
  onMoveImage,
  onRefreshStatus,
  onSelectCaptureTarget,
}: Pick<
  CaptureRailProps,
  "onClear" | "onDropImage" | "onMoveImage" | "onRefreshStatus" | "onSelectCaptureTarget"
> & {
  slot: CaptureSlotView;
  index: number;
  captureTarget: boolean;
}) {
  const definition = slotDefinitions[index];
  if (!definition) return null;
  const actions = {
    onClear: () => onClear(slot.kind),
    onDropImage,
    onRefreshStatus: () => onRefreshStatus(slot.kind),
    onMoveImage: (direction: -1 | 1) => onMoveImage(slot.kind, direction),
    onSelectCapture: () => onSelectCaptureTarget(slot.kind),
  };
  const presentation = {
    accentClass: definition.accentClass,
    captureTarget,
    index,
    label: definition.label,
    nextLabel: slotDefinitions[index + 1]?.label,
    previousLabel: slotDefinitions[index - 1]?.label,
    total: slotDefinitions.length,
  };
  return (
    <div className="relative">
      <CaptureSlotCard actions={actions} presentation={presentation} slot={slot} />
    </div>
  );
});
