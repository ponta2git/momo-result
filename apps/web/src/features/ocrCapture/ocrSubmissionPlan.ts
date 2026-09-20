import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import type { OcrJobHintsRequest } from "@/shared/api/ocrJobs";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { memberDisplayName } from "@/shared/domain/members";
import { parseLayoutFamily } from "@/shared/domain/ocr";
import { formatDateTimeLong } from "@/shared/lib/dateTime";

export type OcrSubmissionInput = {
  selectedGameTitle: { id: string; layoutFamily?: string | null | undefined } | undefined;
  selectedHeldEvent?: { heldAt: string; id: string } | undefined;
  setup: SetupFormValues;
  slots: readonly CaptureSlotState[];
};

export type OcrSubmissionPlan = OcrSubmissionInput & {
  hints: OcrJobHintsRequest;
  playedAt: string;
  selectedSlotLabels: string[];
  setupSummary: {
    gameTitle: string;
    heldEvent: string;
    map: string;
    matchNo: string;
    owner: string;
    season: string;
  };
};

type NamedOption = { id: string; name: string };
type SubmissionOptions = {
  mapMasters: readonly NamedOption[];
  seasonMasters: readonly NamedOption[];
  selectedGameTitle:
    | (NonNullable<OcrSubmissionInput["selectedGameTitle"]> & NamedOption)
    | undefined;
  selectedHeldEvent: OcrSubmissionInput["selectedHeldEvent"];
};

/** Snapshots only the selected context and images that the user is about to submit. */
export function buildOcrSubmissionPlan({
  selectedSlotLabels,
  setup,
  setupOptions,
  slots,
}: {
  selectedSlotLabels: string[];
  setup: SetupFormValues;
  setupOptions: SubmissionOptions;
  slots: readonly CaptureSlotState[];
}): OcrSubmissionPlan {
  const { selectedGameTitle, selectedHeldEvent } = setupOptions;
  const layoutFamily = parseLayoutFamily(selectedGameTitle?.layoutFamily);
  return {
    playedAt: selectedHeldEvent?.heldAt ?? new Date().toISOString(),
    hints: {
      knownPlayerAliases: [],
      computerPlayerAliases: [],
      ...(selectedGameTitle ? { gameTitle: selectedGameTitle.name } : {}),
      ...(layoutFamily ? { layoutFamily } : {}),
    },
    selectedGameTitle: selectedGameTitle
      ? { id: selectedGameTitle.id, layoutFamily: selectedGameTitle.layoutFamily }
      : undefined,
    selectedHeldEvent: selectedHeldEvent
      ? { id: selectedHeldEvent.id, heldAt: selectedHeldEvent.heldAt }
      : undefined,
    selectedSlotLabels: [...selectedSlotLabels],
    setup: { ...setup },
    setupSummary: {
      gameTitle: selectedGameTitle?.name ?? setup.gameTitleId,
      heldEvent: selectedHeldEvent ? formatDateTimeLong(selectedHeldEvent.heldAt) : "紐づけなし",
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
