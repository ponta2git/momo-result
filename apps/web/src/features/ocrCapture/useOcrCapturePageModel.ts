import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import type { InputSource } from "@/features/ocrCapture/captureState";
import type {
  OcrCaptureCameraModel,
  OcrCaptureStartModel,
  OcrCaptureTrayModel,
} from "@/features/ocrCapture/ocrCaptureModel";
import { useOcrCaptureSetupSubmission } from "@/features/ocrCapture/OcrCaptureSetup";
import { useOcrCaptureDraftFlow } from "@/features/ocrCapture/useOcrCaptureDraftFlow";
import { useOcrCaptureMutations } from "@/features/ocrCapture/useOcrCaptureMutations";
import { useOcrStartFlow } from "@/features/ocrCapture/useOcrStartFlow";
import { authQueryOptions } from "@/shared/auth/authQueries";
import { useDevUser } from "@/shared/auth/useDevUser";
import type { SlotKind } from "@/shared/domain/ocr";

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
export function useOcrCapturePageModel() {
  const [startError, setStartError] = useState<string>();
  const setup = useOcrCaptureSetupSubmission();
  const [captureTargetKind, setCaptureTargetKind] = useState<SlotKind>("total_assets");
  const [captureActionFeedback, setCaptureActionFeedback] = useState<string>();

  const draftFlow = useOcrCaptureDraftFlow({
    onDraftLoadError: (error) => setCaptureActionFeedback(error.detail || error.title),
  });
  const captureSubmission = useOcrCaptureMutations();
  const startFlow = useOcrStartFlow({
    submission: captureSubmission,
    onSlotReceipt: draftFlow.applyReceipt,
  });
  const draftFeedback = useMemo(
    () => ({
      reportFailure: setCaptureActionFeedback,
      reportSuccess: setCaptureActionFeedback,
    }),
    [],
  );

  const view = draftFlow.buildView({
    targetKind: captureTargetKind,
    locked: startFlow.locked,
    submitting: captureSubmission.isSubmitting,
    setupReady: setup.resolution.kind === "ready",
  });

  const {
    handleAddImage,
    handleClear,
    handleDropImage,
    handleMoveImage,
    handleResetAll,
    nextEmptyTarget,
    prepareSubmission,
    selectTarget,
  } = draftFlow;
  const openStart = startFlow.open;
  const selectCaptureTarget = useCallback(
    (kind: SlotKind) => {
      const selection = selectTarget(kind);
      if (selection.kind === "blocked") {
        setCaptureActionFeedback(selection.message);
        return;
      }
      setCaptureTargetKind(selection.target);
      setCaptureActionFeedback(undefined);
    },
    [selectTarget],
  );

  const selectImage = useCallback(
    (file: File, source: InputSource) => {
      const added = handleAddImage(file, source, captureTargetKind, draftFeedback);
      if (!added) return;

      const nextEmpty = nextEmptyTarget(captureTargetKind);
      if (nextEmpty) setCaptureTargetKind(nextEmpty);
    },
    [handleAddImage, nextEmptyTarget, captureTargetKind, draftFeedback],
  );

  const startOcr = useCallback(() => {
    const preparation = prepareSubmission({
      setupResolution: setup.resolution,
      blockedReason: setup.blockedReason,
      setupOptions: setup.options,
      nowIso: new Date().toISOString(),
    });
    if (preparation.kind === "blocked") {
      setStartError(preparation.message);
      return;
    }
    setStartError(undefined);
    openStart(preparation.plan);
  }, [prepareSubmission, setup.resolution, setup.blockedReason, setup.options, openStart]);
  const clear = useCallback(
    (kind: SlotKind) => handleClear(kind, draftFeedback),
    [handleClear, draftFeedback],
  );
  const drop = useCallback(
    (sourceKind: SlotKind, targetKind: SlotKind) =>
      handleDropImage(sourceKind, targetKind, draftFeedback),
    [handleDropImage, draftFeedback],
  );
  const move = useCallback(
    (kind: SlotKind, direction: -1 | 1) => handleMoveImage(kind, direction, draftFeedback),
    [handleMoveImage, draftFeedback],
  );
  const reset = useCallback(() => handleResetAll(draftFeedback), [handleResetAll, draftFeedback]);

  const camera = useMemo<OcrCaptureCameraModel>(
    () => ({
      actionVariant: view.camera.actionVariant,
      disabled: view.camera.disabled,
      slotLabel: view.camera.target.label,
      reportValidationError: draftFeedback.reportFailure,
      selectImage,
    }),
    [
      view.camera.actionVariant,
      view.camera.disabled,
      view.camera.target.label,
      draftFeedback.reportFailure,
      selectImage,
    ],
  );
  const tray = useMemo<OcrCaptureTrayModel>(
    () => ({
      actionFeedback: captureActionFeedback,
      captureTargetKind,
      selectedImageCount: view.selectedImageCount,
      totalSlotCount: view.totalSlotCount,
      slots: draftFlow.slots,
      clear,
      drop,
      move,
      refreshStatus: draftFlow.handleRefreshStatus,
      selectTarget: selectCaptureTarget,
    }),
    [
      captureActionFeedback,
      captureTargetKind,
      view.selectedImageCount,
      view.totalSlotCount,
      draftFlow.slots,
      clear,
      drop,
      move,
      draftFlow.handleRefreshStatus,
      selectCaptureTarget,
    ],
  );
  const blockedReason = setup.options.refreshing ? undefined : setup.blockedReason;
  const start = useMemo<OcrCaptureStartModel>(
    () => ({
      badgeLabel: view.start.badgeLabel,
      buttonLabel: view.start.buttonLabel,
      description: view.start.description,
      disabled: view.start.disabled,
      blockedReason,
      error: startError,
      selectedImageCount: view.selectedImageCount,
      resetDisabled: view.resetDisabled,
      reset,
      run: startOcr,
    }),
    [
      view.start.badgeLabel,
      view.start.buttonLabel,
      view.start.description,
      view.start.disabled,
      blockedReason,
      startError,
      view.selectedImageCount,
      view.resetDisabled,
      reset,
      startOcr,
    ],
  );

  return {
    camera,
    tray,
    start,
    navigation: {
      guard: {
        dirty: view.selectedImageCount > 0,
        isNavigationAllowed: startFlow.isNavigationAllowed,
        onDiscard: () => undefined,
      },
      pending: startFlow.locked,
    },
    dialog: {
      navigationPending: startFlow.isNavigating,
      close: startFlow.close,
      confirm: startFlow.confirm,
      view: startFlow.dialog,
      viewMatches: startFlow.viewMatches,
    },
  };
}
