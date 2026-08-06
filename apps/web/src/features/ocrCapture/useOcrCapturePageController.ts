import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { InputSource } from "@/features/ocrCapture/captureState";
import { buildOcrHints } from "@/features/ocrCapture/hints";
import { defaultSetupValues, setupSchema } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { isWorkingStatus } from "@/features/ocrCapture/slotPolicy";
import { useOcrCaptureDraftFlow } from "@/features/ocrCapture/useOcrCaptureDraftFlow";
import { useOcrCaptureMutations } from "@/features/ocrCapture/useOcrCaptureMutations";
import { useOcrCaptureQueries } from "@/features/ocrCapture/useOcrCaptureQueries";
import { useOcrSetupOptions } from "@/features/ocrCapture/useOcrSetupOptions";
import { useOcrStartFlow } from "@/features/ocrCapture/useOcrStartFlow";
import type { OcrSubmissionPlan } from "@/features/ocrCapture/useOcrStartFlow";
import { parseLayoutFamily } from "@/shared/api/enums";
import type { SlotKind } from "@/shared/api/enums";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { memberDisplayName } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { trimSearchParam } from "@/shared/lib/searchParams";
import { showToast } from "@/shared/ui/feedback/Toast";

function notify(message: string, tone: "info" | "success" | "warning" = "info") {
  showToast({ title: message, tone });
}

export function useOcrCapturePageController() {
  const [searchParams] = useSearchParams();
  const requestedHeldEventId = trimSearchParam(searchParams.get("heldEventId"));
  const [setup, setSetup] = useState<SetupFormValues>(() => ({
    ...defaultSetupValues,
    ...(requestedHeldEventId ? { heldEventId: requestedHeldEventId } : {}),
  }));
  const [captureTargetKind, setCaptureTargetKind] = useState<SlotKind>("total_assets");

  const { auth, memberAliasDirectory } = useOcrCaptureQueries();
  const setupOptions = useOcrSetupOptions({
    authAccountId: auth.accountId,
    enabled: auth.ready,
    onChange: setSetup,
    value: setup,
  });
  const hints = useMemo(() => {
    const input: { gameTitleName?: string; layoutFamily?: "momotetsu_2" | "world" | "reiwa" } = {};
    if (setupOptions.selectedGameTitle?.name) {
      input.gameTitleName = setupOptions.selectedGameTitle.name;
    }
    const layoutFamily = parseLayoutFamily(setupOptions.selectedGameTitle?.layoutFamily);
    if (layoutFamily) {
      input.layoutFamily = layoutFamily;
    }
    return buildOcrHints(input, memberAliasDirectory);
  }, [memberAliasDirectory, setupOptions.selectedGameTitle]);
  const flow = useOcrCaptureDraftFlow();
  const submission = useOcrCaptureMutations(hints);
  const startFlow = useOcrStartFlow({ submission, updateSlot: flow.updateSlot });

  function handleValidationError(message: string) {
    notify(message);
  }

  function handleSelectCaptureTarget(kind: SlotKind) {
    const slot = flow.slots.find((candidate) => candidate.kind === kind);
    if (slot && isWorkingStatus(slot.status)) {
      notify("読み取り中の分類は撮影先に変更できません。", "warning");
      return;
    }
    setCaptureTargetKind(kind);
    const label = slotDefinitions.find((definition) => definition.kind === kind)?.label ?? kind;
    showToast({ title: `次の撮影先を${label}に変更しました。`, tone: "info" });
  }

  function handleImageSelected(file: File, source: InputSource) {
    const added = flow.handleAddImage(file, source, captureTargetKind, notify);
    if (!added) return;

    const nextEmpty = flow.slots.find(
      (slot) => slot.kind !== captureTargetKind && !slot.file && !isWorkingStatus(slot.status),
    );
    if (nextEmpty) {
      setCaptureTargetKind(nextEmpty.kind);
    }
  }

  const ocrReadyCount = flow.slots.filter(
    (slot) => slot.file && ["selected", "failed", "cancelled"].includes(slot.status),
  ).length;
  const hasWorkingSlot = flow.slots.some((slot) => isWorkingStatus(slot.status));
  const setupValidation = setupSchema.safeParse(setup);
  const setupReady = setupOptions.ready && setupValidation.success;
  const setupBlockedReason = auth.ready
    ? setupOptions.loading || setupOptions.refreshing
      ? "試合設定の選択肢を確認しています。"
      : setupValidation.success
        ? undefined
        : (setupValidation.error.issues[0]?.message ?? "試合設定を確認してください。")
    : "ログイン状態を確認中です。";
  const selectedSlotLabels = slotDefinitions
    .filter((definition) =>
      flow.slots.some(
        (slot) =>
          slot.kind === definition.kind &&
          slot.file &&
          ["selected", "failed", "cancelled"].includes(slot.status),
      ),
    )
    .map((definition) => definition.label);

  function createSubmissionPlan(): OcrSubmissionPlan {
    const slots = flow.slots
      .filter((slot) => slot.file && ["selected", "failed", "cancelled"].includes(slot.status))
      .map((slot) => Object.assign({}, slot));
    const selectedKinds = new Set(slots.map((slot) => slot.kind));

    return {
      selectedGameTitle: setupOptions.selectedGameTitle
        ? { ...setupOptions.selectedGameTitle }
        : undefined,
      selectedHeldEvent: setupOptions.selectedHeldEvent
        ? { ...setupOptions.selectedHeldEvent }
        : undefined,
      selectedSlotLabels: slotDefinitions
        .filter((definition) => selectedKinds.has(definition.kind))
        .map((definition) => definition.label),
      setup: { ...setup },
      setupSummary: {
        heldEvent: setupOptions.selectedHeldEvent
          ? formatDateTimeLong(setupOptions.selectedHeldEvent.heldAt)
          : "紐づけなし",
        gameTitle: setupOptions.selectedGameTitle?.name ?? setup.gameTitleId,
        map:
          setupOptions.mapMasters.find((item) => item.id === setup.mapMasterId)?.name ??
          setup.mapMasterId,
        owner: memberDisplayName(setup.ownerMemberId),
        matchNo: setup.matchNoInEvent ? `第${setup.matchNoInEvent}試合` : "確定時に設定",
        season:
          setupOptions.seasonMasters.find((item) => item.id === setup.seasonMasterId)?.name ??
          setup.seasonMasterId,
      },
      slots,
    };
  }

  function handleStartOcr() {
    if (!setupReady) {
      notify(setupBlockedReason ?? "試合設定を確認してください。", "warning");
      return;
    }
    if (ocrReadyCount === 0) {
      notify("読み取る画像がありません。まず画像を撮影してください。", "warning");
      return;
    }

    startFlow.open(createSubmissionPlan());
  }

  function handleDraftLoadError(error: NormalizedApiError) {
    notify(error.detail || error.title, "warning");
  }

  return {
    auth,
    captureTargetKind,
    flow,
    handleCloseStartDialog: startFlow.close,
    handleConfirmStart: startFlow.confirm,
    handleDraftLoadError,
    handleStartOcr,
    handleImageSelected,
    handleSelectCaptureTarget,
    handleValidationError,
    handleViewMatches: startFlow.viewMatches,
    hasWorkingSlot,
    notify,
    ocrReadyCount,
    ocrStartDialog: startFlow.state,
    selectedSlotLabels,
    setSetup,
    setup,
    setupBlockedReason,
    setupOptions,
    setupReady,
    submission,
    submissionLocked: startFlow.locked,
  };
}
