import type { CaptureSlotState, InputSource } from "@/features/ocrCapture/captureState";
import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { OcrDraftResponse } from "@/features/ocrCapture/api";
import { CaptureSlotCard } from "@/features/ocrCapture/CaptureSlotCard";
import type { SlotKind } from "@/shared/api/enums";

type CaptureRailProps = {
  slots: CaptureSlotState[];
  drafts: Partial<Record<SlotKind, OcrDraftResponse>>;
  onSelect: (kind: SlotKind, file: File, source: InputSource) => void;
  onClear: (kind: SlotKind) => void;
  onForceKind: (kind: SlotKind) => void;
  onValidationError: (kind: SlotKind, message: string) => void;
  onManualRefresh: (kind: SlotKind) => void;
};

export function CaptureRail({
  slots,
  drafts,
  onSelect,
  onClear,
  onForceKind,
  onValidationError,
  onManualRefresh,
}: CaptureRailProps) {
  return (
    <section className="grid gap-5 xl:grid-cols-3" aria-label="OCR画像取り込み">
      {slotDefinitions.map((definition) => {
        const slot = slots.find((candidate) => candidate.kind === definition.kind);
        if (!slot) {
          return null;
        }
        return (
          <CaptureSlotCard
            key={definition.kind}
            slot={slot}
            label={definition.label}
            accentClass={definition.accentClass}
            draft={drafts[definition.kind]}
            onSelect={(file, source) => onSelect(definition.kind, file, source)}
            onClear={() => onClear(definition.kind)}
            onForceKind={() => onForceKind(definition.kind)}
            onValidationError={(message) => onValidationError(definition.kind, message)}
            onManualRefresh={() => onManualRefresh(definition.kind)}
          />
        );
      })}
    </section>
  );
}
