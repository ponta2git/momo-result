import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import type { OcrSetupOptions } from "@/features/ocrCapture/useOcrSetupOptions";
import type { OcrSubmissionPlan } from "@/features/ocrCapture/useOcrStartFlow";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { memberDisplayName } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";

/** Freezes the current capture/setup state into the immutable plan reviewed before submission. */
export function buildOcrSubmissionPlan({
  selectedSlotLabels,
  setup,
  setupOptions,
  slots,
}: {
  selectedSlotLabels: string[];
  setup: SetupFormValues;
  setupOptions: OcrSetupOptions;
  slots: CaptureSlotState[];
}): OcrSubmissionPlan {
  return {
    selectedGameTitle: setupOptions.selectedGameTitle
      ? { ...setupOptions.selectedGameTitle }
      : undefined,
    selectedHeldEvent: setupOptions.selectedHeldEvent
      ? { ...setupOptions.selectedHeldEvent }
      : undefined,
    selectedSlotLabels: [...selectedSlotLabels],
    setup: { ...setup },
    setupSummary: {
      gameTitle: setupOptions.selectedGameTitle?.name ?? setup.gameTitleId,
      heldEvent: setupOptions.selectedHeldEvent
        ? formatDateTimeLong(setupOptions.selectedHeldEvent.heldAt)
        : "紐づけなし",
      map:
        setupOptions.mapMasters.find((item) => item.id === setup.mapMasterId)?.name ??
        setup.mapMasterId,
      matchNo: formatMatchNoInEvent(setup.matchNoInEvent, "確定時に設定"),
      owner: memberDisplayName(setup.ownerMemberId),
      season:
        setupOptions.seasonMasters.find((item) => item.id === setup.seasonMasterId)?.name ??
        setup.seasonMasterId,
    },
    slots: slots.map((slot) => ({ ...slot })),
  };
}
