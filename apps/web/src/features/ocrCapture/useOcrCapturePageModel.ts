import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState, InputSource } from "@/features/ocrCapture/captureState";
import { buildOcrHints } from "@/features/ocrCapture/hints";
import { buildOcrSetupPanelModel } from "@/features/ocrCapture/ocrSetupPanelModel";
import type { OcrSetupPanelModel } from "@/features/ocrCapture/ocrSetupPanelModel";
import { buildOcrSubmissionPlan } from "@/features/ocrCapture/ocrSubmissionPlan";
import { defaultSetupValues, setupSchema } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { isWorkingStatus } from "@/features/ocrCapture/slotPolicy";
import { useOcrCaptureDraftFlow } from "@/features/ocrCapture/useOcrCaptureDraftFlow";
import { useOcrCaptureMutations } from "@/features/ocrCapture/useOcrCaptureMutations";
import { useOcrCaptureQueries } from "@/features/ocrCapture/useOcrCaptureQueries";
import type { OcrCaptureAuthSlice } from "@/features/ocrCapture/useOcrCaptureQueries";
import { useOcrSetupOptions } from "@/features/ocrCapture/useOcrSetupOptions";
import { useOcrStartFlow } from "@/features/ocrCapture/useOcrStartFlow";
import type { OcrStartDialogState } from "@/features/ocrCapture/useOcrStartFlow";
import { parseLayoutFamily } from "@/shared/api/enums";
import type { SlotKind } from "@/shared/api/enums";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { trimSearchParam } from "@/shared/lib/searchParams";
import type { SlotMap } from "@/shared/lib/slotMap";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";
import { showToast } from "@/shared/ui/feedback/Toast";

type MemberAliasesFeedback = {
  error: NormalizedApiError | undefined;
  refresh: () => void;
  refreshing: boolean;
};

export type OcrCapturePageModel = {
  capture: {
    camera: {
      actionVariant: "primary" | "secondary";
      disabled: boolean;
      reportValidationError: (message: string) => void;
      selectImage: (file: File, source: InputSource) => void;
      target: { accentClass: string; label: string };
    };
    selectedImageCount: number;
    totalSlotCount: number;
    tray: {
      captureTargetKind: SlotKind;
      clear: (kind: SlotKind) => void;
      drafts: SlotMap<OcrDraftResponse>;
      drop: (sourceKind: SlotKind, targetKind: SlotKind) => void;
      move: (kind: SlotKind, direction: -1 | 1) => void;
      refreshStatus: (kind: SlotKind) => void;
      reset: () => void;
      resetDisabled: boolean;
      selectTarget: (kind: SlotKind) => void;
      slots: CaptureSlotState[];
    };
  };
  feedback: {
    auth: OcrCaptureAuthSlice;
    memberAliases: MemberAliasesFeedback;
  };
  navigation: { returnTo: string | undefined };
  setup: {
    choices: { failed: boolean; refresh: () => void; refreshing: boolean };
    panel: OcrSetupPanelModel;
  };
  submission: {
    dialog: {
      close: () => void;
      confirm: () => Promise<void>;
      state: OcrStartDialogState;
      viewMatches: () => void;
    };
    monitoring: {
      recordDraft: (kind: SlotKind, draft: OcrDraftResponse) => void;
      reportDraftLoadError: (error: NormalizedApiError) => void;
      setRefreshing: (kind: SlotKind, refreshing: boolean) => void;
      slots: CaptureSlotState[];
      updateSlot: (slot: CaptureSlotState) => void;
    };
    start: {
      badgeLabel: string;
      blockedReason: string | undefined;
      buttonLabel: string;
      description: string;
      disabled: boolean;
      run: () => void;
    };
  };
};

const readyStatuses = new Set(["selected", "failed", "cancelled"]);

function notify(message: string, tone: "info" | "success" | "warning" = "info") {
  showToast({ title: message, tone });
}

/** Owns OCR capture screen state and exposes only view-ready slices and user intents. */
export function useOcrCapturePageModel(): OcrCapturePageModel {
  const [searchParams] = useSearchParams();
  const requestedHeldEventId = trimSearchParam(searchParams.get("heldEventId"));
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const [setupValue, setSetupValue] = useState<SetupFormValues>(() => ({
    ...defaultSetupValues,
    ...(requestedHeldEventId ? { heldEventId: requestedHeldEventId } : {}),
  }));
  const [captureTargetKind, setCaptureTargetKind] = useState<SlotKind>("total_assets");

  const referenceData = useOcrCaptureQueries();
  const setupOptions = useOcrSetupOptions({
    authAccountId: referenceData.auth.accountId,
    enabled: referenceData.auth.ready,
    onChange: setSetupValue,
    value: setupValue,
  });
  const hints = useMemo(() => {
    const input: { gameTitleName?: string; layoutFamily?: "momotetsu_2" | "world" | "reiwa" } = {};
    if (setupOptions.selectedGameTitle?.name) {
      input.gameTitleName = setupOptions.selectedGameTitle.name;
    }
    const layoutFamily = parseLayoutFamily(setupOptions.selectedGameTitle?.layoutFamily);
    if (layoutFamily) input.layoutFamily = layoutFamily;
    return buildOcrHints(input, referenceData.memberAliases.directory);
  }, [referenceData.memberAliases.directory, setupOptions.selectedGameTitle]);
  const draftFlow = useOcrCaptureDraftFlow();
  const captureSubmission = useOcrCaptureMutations(hints);
  const startFlow = useOcrStartFlow({
    submission: captureSubmission,
    updateSlot: draftFlow.updateSlot,
  });

  const captureTarget = slotDefinitions.find((definition) => definition.kind === captureTargetKind);
  if (!captureTarget) {
    throw new Error(`Unknown OCR capture target: ${captureTargetKind}`);
  }

  const readySlots = draftFlow.slots.filter((slot) => slot.file && readyStatuses.has(slot.status));
  const selectedSlotLabels = slotDefinitions
    .filter((definition) => readySlots.some((slot) => slot.kind === definition.kind))
    .map((definition) => definition.label);
  const selectedImageCount = draftFlow.slots.filter((slot) => Boolean(slot.file)).length;
  const hasWorkingSlot = draftFlow.slots.some((slot) => isWorkingStatus(slot.status));
  const cameraDisabled = startFlow.locked || hasWorkingSlot;
  const setupValidation = setupSchema.safeParse(setupValue);
  const setupReady = setupOptions.ready && setupValidation.success;
  const setupBlockedReason = referenceData.auth.ready
    ? setupOptions.loading || setupOptions.refreshing
      ? "試合設定の選択肢を確認しています。"
      : setupValidation.success
        ? undefined
        : (setupValidation.error.issues[0]?.message ?? "試合設定を確認してください。")
    : "ログイン状態を確認中です。";

  const selectCaptureTarget = (kind: SlotKind) => {
    const slot = draftFlow.slots.find((candidate) => candidate.kind === kind);
    if (slot && isWorkingStatus(slot.status)) {
      notify("読み取り中の分類は撮影先に変更できません。", "warning");
      return;
    }
    setCaptureTargetKind(kind);
  };

  const selectImage = (file: File, source: InputSource) => {
    const added = draftFlow.handleAddImage(file, source, captureTargetKind, notify);
    if (!added) return;

    const nextEmpty = draftFlow.slots.find(
      (slot) => slot.kind !== captureTargetKind && !slot.file && !isWorkingStatus(slot.status),
    );
    if (nextEmpty) setCaptureTargetKind(nextEmpty.kind);
  };

  const startOcr = () => {
    if (!setupReady) {
      notify(setupBlockedReason ?? "試合設定を確認してください。", "warning");
      return;
    }
    if (readySlots.length === 0) {
      notify("読み取る画像がありません。まず画像を撮影してください。", "warning");
      return;
    }
    startFlow.open(
      buildOcrSubmissionPlan({
        selectedSlotLabels,
        setup: setupValue,
        setupOptions,
        slots: readySlots,
      }),
    );
  };
  const selectedDescription =
    selectedSlotLabels.length > 0
      ? `${selectedSlotLabels.join("・")}を読み取ります。${
          readySlots.length < slotDefinitions.length
            ? "未配置の分類は確認画面で手入力できます。"
            : "3種類すべて揃っています。"
        }`
      : "分類トレイを選び、まず1枚撮影してください。";

  return {
    capture: {
      camera: {
        actionVariant: selectedImageCount === slotDefinitions.length ? "secondary" : "primary",
        disabled: cameraDisabled,
        reportValidationError: notify,
        selectImage,
        target: {
          accentClass: captureTarget.accentClass,
          label: captureTarget.label,
        },
      },
      selectedImageCount,
      totalSlotCount: slotDefinitions.length,
      tray: {
        captureTargetKind,
        clear: (kind) => draftFlow.handleClear(kind, notify),
        drafts: draftFlow.drafts,
        drop: (sourceKind, targetKind) => draftFlow.handleDropImage(sourceKind, targetKind, notify),
        move: (kind, direction) => draftFlow.handleMoveImage(kind, direction, notify),
        refreshStatus: draftFlow.handleRefreshStatus,
        reset: () => draftFlow.handleResetAll(notify),
        resetDisabled: selectedImageCount === 0 || cameraDisabled,
        selectTarget: selectCaptureTarget,
        slots: draftFlow.slots,
      },
    },
    feedback: {
      auth: referenceData.auth,
      memberAliases: referenceData.memberAliases.feedback,
    },
    navigation: { returnTo },
    setup: {
      choices: {
        failed: setupOptions.hasError,
        refresh: setupOptions.retry,
        refreshing: setupOptions.refreshing,
      },
      panel: buildOcrSetupPanelModel({
        enabled: referenceData.auth.ready,
        options: setupOptions,
        setValue: setSetupValue,
        value: setupValue,
      }),
    },
    submission: {
      dialog: {
        close: startFlow.close,
        confirm: startFlow.confirm,
        state: startFlow.state,
        viewMatches: startFlow.viewMatches,
      },
      monitoring: {
        recordDraft: draftFlow.setDraft,
        reportDraftLoadError: (error) => notify(error.detail || error.title, "warning"),
        setRefreshing: draftFlow.setStatusRefreshPending,
        slots: draftFlow.slots,
        updateSlot: draftFlow.updateSlot,
      },
      start: {
        badgeLabel: readySlots.length === 0 ? "画像未選択" : `${readySlots.length}件を送信`,
        blockedReason: setupBlockedReason,
        buttonLabel:
          readySlots.length === 0 ? "読み取りを開始" : `${readySlots.length}件で読み取りを開始`,
        description: selectedDescription,
        disabled:
          readySlots.length === 0 ||
          hasWorkingSlot ||
          captureSubmission.isSubmitting ||
          !setupReady,
        run: startOcr,
      },
    },
  };
}
