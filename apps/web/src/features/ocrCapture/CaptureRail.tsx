import type { OcrDraftResponse } from "@/features/ocrCapture/api";
import { CaptureSlotCard } from "@/features/ocrCapture/CaptureSlotCard";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { SlotKind } from "@/shared/api/enums";
import type { SlotMap } from "@/shared/lib/slotMap";
import { cn } from "@/shared/ui/cn";

type CaptureRailProps = {
  layout?: "rail" | "stack";
  slots: CaptureSlotState[];
  drafts: SlotMap<OcrDraftResponse>;
  onClear: (kind: SlotKind) => void;
  onDropImage: (sourceKind: SlotKind, targetKind: SlotKind) => void;
  onMoveImage: (kind: SlotKind, direction: -1 | 1) => void;
  onManualRefresh: (kind: SlotKind) => void;
};

export function CaptureRail({
  layout = "rail",
  slots,
  drafts,
  onClear,
  onDropImage,
  onMoveImage,
  onManualRefresh,
}: CaptureRailProps) {
  return (
    <section
      className={cn("grid gap-5", layout === "rail" ? "xl:grid-cols-3" : "")}
      aria-label="画像取り込み"
    >
      {slotDefinitions.map((definition, index) => {
        const slot = slots.find((candidate) => candidate.kind === definition.kind);
        if (!slot) {
          return null;
        }
        return (
          <CaptureSlotCard
            key={definition.kind}
            slot={slot}
            label={definition.label}
            stationLabel={definition.stationLabel}
            accentClass={definition.accentClass}
            draft={drafts[definition.kind]}
            index={index}
            total={slotDefinitions.length}
            onClear={() => onClear(definition.kind)}
            onDropImage={onDropImage}
            onMoveImage={(direction) => onMoveImage(definition.kind, direction)}
            onManualRefresh={() => onManualRefresh(definition.kind)}
          />
        );
      })}
    </section>
  );
}
