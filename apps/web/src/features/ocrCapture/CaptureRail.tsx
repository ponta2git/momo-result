import { CaptureSlotCard } from "@/features/ocrCapture/CaptureSlotCard";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { SlotKind } from "@/shared/api/enums";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { SlotMap } from "@/shared/lib/slotMap";
import { cn } from "@/shared/ui/cn";

type CaptureRailProps = {
  captureTargetKind: SlotKind;
  layout?: "rail" | "stack";
  slots: CaptureSlotState[];
  drafts: SlotMap<OcrDraftResponse>;
  statusRefreshing: SlotMap<boolean>;
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
  drafts,
  statusRefreshing,
  onClear,
  onDropImage,
  onMoveImage,
  onRefreshStatus,
  onSelectCaptureTarget,
}: CaptureRailProps) {
  return (
    <section
      className={cn("grid gap-3", layout === "rail" ? "xl:grid-cols-3" : "")}
      aria-label="画像取り込み"
    >
      {slotDefinitions.map((definition, index) => {
        const slot = slots.find((candidate) => candidate.kind === definition.kind);
        if (!slot) {
          return null;
        }
        const actions = {
          onClear: () => onClear(definition.kind),
          onDropImage,
          onRefreshStatus: () => onRefreshStatus(definition.kind),
          onMoveImage: (direction: -1 | 1) => onMoveImage(definition.kind, direction),
          onSelectCapture: () => onSelectCaptureTarget(definition.kind),
        };
        const presentation = {
          accentClass: definition.accentClass,
          captureTarget: definition.kind === captureTargetKind,
          index,
          label: definition.label,
          nextLabel: slotDefinitions[index + 1]?.label,
          previousLabel: slotDefinitions[index - 1]?.label,
          total: slotDefinitions.length,
        };

        return (
          <div key={definition.kind} className="relative">
            <CaptureSlotCard
              actions={actions}
              draft={drafts[definition.kind]}
              presentation={presentation}
              statusRefreshing={statusRefreshing[definition.kind] ?? false}
              slot={slot}
            />
          </div>
        );
      })}
    </section>
  );
}
