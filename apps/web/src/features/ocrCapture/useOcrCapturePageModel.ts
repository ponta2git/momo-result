import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { InputSource } from "@/features/ocrCapture/captureState";
import { buildOcrSubmissionPlan } from "@/features/ocrCapture/ocrSubmissionPlan";
import { defaultSetupValues } from "@/features/ocrCapture/schema";
import { isWorkingStatus } from "@/features/ocrCapture/slotPolicy";
import { useOcrCaptureDraftFlow } from "@/features/ocrCapture/useOcrCaptureDraftFlow";
import { useOcrCaptureMutations } from "@/features/ocrCapture/useOcrCaptureMutations";
import { useOcrSetup } from "@/features/ocrCapture/useOcrSetup";
import { useOcrStartFlow } from "@/features/ocrCapture/useOcrStartFlow";
import { authQueryOptions } from "@/shared/auth/authQueries";
import { useDevUser } from "@/shared/auth/useDevUser";
import type { SlotKind } from "@/shared/domain/ocr";
import { trimSearchParam } from "@/shared/lib/searchParams";

const readyStatuses = new Set(["selected", "failed", "cancelled"]);

/** Authentication remains outside the principal-scoped editor so remounting does not refetch it. */
export function useOcrCaptureAuth() {
  const { devUser } = useDevUser();
  const query = useQuery({ ...authQueryOptions(devUser), retry: false });
  return {
    accountId: query.data?.accountId,
    ready: query.isSuccess && query.data !== null,
  };
}

/** Owns OCR capture screen state and exposes only view-ready slices and user intents. */
export function useOcrCapturePageModel(authReady: boolean) {
  const [startError, setStartError] = useState<string>();
  const [searchParams] = useSearchParams();
  const requestedHeldEventId = trimSearchParam(searchParams.get("heldEventId"));
  const setup = useOcrSetup({
    enabled: authReady,
    initialValue: {
      ...defaultSetupValues,
      ...(requestedHeldEventId ? { heldEventId: requestedHeldEventId } : {}),
    },
  });
  const [captureTargetKind, setCaptureTargetKind] = useState<SlotKind>("total_assets");
  const [captureActionFeedback, setCaptureActionFeedback] = useState<string>();

  const draftFlow = useOcrCaptureDraftFlow({
    onDraftLoadError: (error) => setCaptureActionFeedback(error.detail || error.title),
  });
  const captureSubmission = useOcrCaptureMutations();
  const startFlow = useOcrStartFlow({
    submission: captureSubmission,
    updateSlot: draftFlow.updateSlot,
  });
  const draftFeedback = {
    reportFailure: setCaptureActionFeedback,
    reportSuccess: setCaptureActionFeedback,
  };

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

  const selectCaptureTarget = (kind: SlotKind) => {
    const slot = draftFlow.slots.find((candidate) => candidate.kind === kind);
    if (slot && isWorkingStatus(slot.status)) {
      setCaptureActionFeedback("読み取り中の分類は撮影先に変更できません。");
      return;
    }
    setCaptureTargetKind(kind);
    setCaptureActionFeedback(undefined);
  };

  const selectImage = (file: File, source: InputSource) => {
    const added = draftFlow.handleAddImage(file, source, captureTargetKind, draftFeedback);
    if (!added) return;

    const nextEmpty = draftFlow.slots.find(
      (slot) => slot.kind !== captureTargetKind && !slot.file && !isWorkingStatus(slot.status),
    );
    if (nextEmpty) setCaptureTargetKind(nextEmpty.kind);
  };

  const startOcr = () => {
    if (setup.resolution.kind !== "ready") {
      setStartError(setup.blockedReason ?? "試合設定を確認してください。");
      return;
    }
    if (readySlots.length === 0) {
      setStartError("読み取る画像がありません。まず画像を撮影してください。");
      return;
    }
    setStartError(undefined);
    startFlow.open(
      buildOcrSubmissionPlan({
        selectedSlotLabels,
        setup: setup.resolution.value,
        setupOptions: setup.options,
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
    startError,
    capture: {
      camera: {
        actionVariant:
          selectedImageCount === slotDefinitions.length
            ? ("secondary" as const)
            : ("primary" as const),
        disabled: cameraDisabled,
        reportValidationError: draftFeedback.reportFailure,
        selectImage,
        target: {
          label: captureTarget.label,
        },
      },
      selectedImageCount,
      totalSlotCount: slotDefinitions.length,
      tray: {
        actionFeedback: captureActionFeedback,
        captureTargetKind,
        clear: (kind: SlotKind) => draftFlow.handleClear(kind, draftFeedback),
        drafts: draftFlow.drafts,
        drop: (sourceKind: SlotKind, targetKind: SlotKind) =>
          draftFlow.handleDropImage(sourceKind, targetKind, draftFeedback),
        move: (kind: SlotKind, direction: -1 | 1) =>
          draftFlow.handleMoveImage(kind, direction, draftFeedback),
        refreshStatus: draftFlow.handleRefreshStatus,
        reset: () => draftFlow.handleResetAll(draftFeedback),
        resetDisabled: selectedImageCount === 0 || cameraDisabled,
        selectTarget: selectCaptureTarget,
        slots: draftFlow.slots,
        statusRefreshing: draftFlow.statusRefreshing,
      },
    },
    navigation: {
      guard: {
        dirty: selectedImageCount > 0,
        navigationAllowedRef: startFlow.navigationAllowedRef,
        onDiscard: () => undefined,
      },
      pending: startFlow.locked,
    },
    setup: {
      choices: {
        failed: setup.options.hasError,
        refresh: setup.options.retry,
        refreshing: setup.options.refreshing,
      },
      panel: setup.panel,
    },
    submission: {
      dialog: {
        navigationPending: startFlow.isNavigating,
        close: startFlow.close,
        confirm: startFlow.confirm,
        state: startFlow.state,
        viewMatches: startFlow.viewMatches,
      },
      start: {
        badgeLabel: readySlots.length === 0 ? "画像未選択" : `${readySlots.length}件を送信`,
        blockedReason: setup.blockedReason,
        buttonLabel:
          readySlots.length === 0 ? "読み取りを開始" : `${readySlots.length}件で読み取りを開始`,
        description: selectedDescription,
        disabled:
          startFlow.locked ||
          readySlots.length === 0 ||
          hasWorkingSlot ||
          captureSubmission.isSubmitting ||
          setup.resolution.kind !== "ready",
        run: startOcr,
      },
    },
  };
}
