import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { ocrSlotLabels } from "@/features/ocrCapture/ocrCapturePresentation";
import type { OcrSetupResolution } from "@/features/ocrCapture/setup/ocrSetupModel";
import type { OcrSetupValues } from "@/features/ocrCapture/setup/ocrSetupSchema";
import { pickOcrTargets } from "@/features/ocrCapture/slotPolicy";
import type { OcrJobHintsRequest } from "@/shared/api/ocrJobs";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { memberDisplayName } from "@/shared/domain/members";
import { parseLayoutFamily } from "@/shared/domain/ocr";
import { formatDateTimeLong } from "@/shared/lib/dateTime";

export type OcrSubmissionInput = {
  selectedGameTitle: { id: string; layoutFamily?: string | null | undefined } | undefined;
  selectedHeldEvent?: { heldAt: string; id: string } | undefined;
  setup: OcrSetupValues;
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

/** Checks the current selection and snapshots exactly the context and images to submit. */
export function prepareOcrSubmissionPlan({
  setupResolution,
  blockedReason,
  setupOptions,
  slots,
  nowIso,
}: {
  setupResolution: OcrSetupResolution;
  blockedReason: string | undefined;
  setupOptions: SubmissionOptions;
  slots: readonly CaptureSlotState[];
  nowIso: string;
}): { kind: "blocked"; message: string } | { kind: "ready"; plan: OcrSubmissionPlan } {
  if (setupResolution.kind !== "ready") {
    return { kind: "blocked", message: blockedReason ?? "試合設定を確認してください。" };
  }
  const targets = pickOcrTargets(slots);
  if (targets.length === 0) {
    return { kind: "blocked", message: "読み取る画像がありません。まず画像を撮影してください。" };
  }
  const setup = setupResolution.value;
  const { selectedGameTitle, selectedHeldEvent } = setupOptions;
  const layoutFamily = parseLayoutFamily(selectedGameTitle?.layoutFamily);
  if (selectedGameTitle?.layoutFamily != null && !layoutFamily) {
    return {
      kind: "blocked",
      message: "作品の読み取り方式を確認してください。設定画面から修正できます。",
    };
  }
  return {
    kind: "ready",
    plan: {
      playedAt: selectedHeldEvent?.heldAt ?? nowIso,
      hints: {
        knownPlayerAliases: [],
        computerPlayerAliases: [],
        ...(selectedGameTitle ? { gameTitle: selectedGameTitle.name } : {}),
        ...(layoutFamily ? { layoutFamily } : {}),
      },
      selectedGameTitle: selectedGameTitle
        ? { id: selectedGameTitle.id, ...(layoutFamily ? { layoutFamily } : {}) }
        : undefined,
      selectedHeldEvent: selectedHeldEvent
        ? { id: selectedHeldEvent.id, heldAt: selectedHeldEvent.heldAt }
        : undefined,
      selectedSlotLabels: ocrSlotLabels(targets),
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
      slots: targets.map((slot) => Object.assign({}, slot)),
    },
  };
}
