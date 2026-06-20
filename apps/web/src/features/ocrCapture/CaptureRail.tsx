import { motion } from "motion/react";

import { CaptureSlotCard } from "@/features/ocrCapture/CaptureSlotCard";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { SlotKind } from "@/shared/api/enums";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { SlotMap } from "@/shared/lib/slotMap";
import { cn } from "@/shared/ui/cn";
import { momoPanelTransition } from "@/shared/ui/motion/variants";

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
          <motion.div
            key={definition.kind}
            animate={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 6 }}
            transition={{ ...momoPanelTransition, delay: index * 0.03 }}
          >
            <CaptureSlotCard
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
          </motion.div>
        );
      })}
    </section>
  );
}
