import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import type { InputSource } from "@/features/ocrCapture/captureState";
import type {
  OcrCaptureCameraView,
  OcrCaptureStartView,
  OcrCaptureTrayView,
} from "@/features/ocrCapture/ocrCapturePresentation";
import { useOcrCaptureSetupSubmission } from "@/features/ocrCapture/setup/OcrCaptureSetup";
import { useCaptureSlots } from "@/features/ocrCapture/useCaptureSlots";
import { useOcrStartFlow } from "@/features/ocrCapture/useOcrStartFlow";
import { useOcrSubmission } from "@/features/ocrCapture/useOcrSubmission";
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
export function useOcrCapture() {
  const [preparationError, setPreparationError] = useState<string>();
  const setup = useOcrCaptureSetupSubmission();
  const [captureTargetKind, setCaptureTargetKind] = useState<SlotKind>("total_assets");
  const [captureActionFeedback, setCaptureActionFeedback] = useState<string>();

  const captureSlots = useCaptureSlots({
    feedback: {
      reportFailure: setCaptureActionFeedback,
      reportSuccess: setCaptureActionFeedback,
    },
    onDraftLoadError: (error) => setCaptureActionFeedback(error.detail || error.title),
  });
  const submission = useOcrSubmission();
  const startFlow = useOcrStartFlow({
    submission,
    onSlotReceipt: captureSlots.applySubmissionReceipt,
  });
  const view = captureSlots.buildView({
    targetKind: captureTargetKind,
    locked: startFlow.locked,
    submitting: submission.isSubmitting,
    setupReady: setup.resolution.kind === "ready",
  });

  const {
    addImage,
    clearImage,
    swapImages,
    swapWithAdjacentSlot,
    clearAllImages,
    nextEmptyTarget,
    prepareSubmission,
    resolveTarget,
  } = captureSlots;
  const openConfirmation = startFlow.open;
  const selectCaptureTarget = useCallback(
    (kind: SlotKind) => {
      const selection = resolveTarget(kind);
      if (selection.kind === "blocked") {
        setCaptureActionFeedback(selection.message);
        return;
      }
      setCaptureTargetKind(selection.target);
      setCaptureActionFeedback(undefined);
    },
    [resolveTarget],
  );

  const selectImage = useCallback(
    (file: File, source: InputSource) => {
      const added = addImage(file, source, captureTargetKind);
      if (!added) return;

      const nextEmpty = nextEmptyTarget(captureTargetKind);
      if (nextEmpty) setCaptureTargetKind(nextEmpty);
    },
    [addImage, nextEmptyTarget, captureTargetKind],
  );

  const reviewSubmission = useCallback(() => {
    const preparation = prepareSubmission({
      setupResolution: setup.resolution,
      blockedReason: setup.blockedReason,
      setupOptions: setup.options,
      nowIso: new Date().toISOString(),
    });
    if (preparation.kind === "blocked") {
      setPreparationError(preparation.message);
      return;
    }
    setPreparationError(undefined);
    openConfirmation(preparation.plan);
  }, [prepareSubmission, setup.resolution, setup.blockedReason, setup.options, openConfirmation]);
  const camera = useMemo<OcrCaptureCameraView>(
    () => ({
      actionVariant: view.camera.actionVariant,
      disabled: view.camera.disabled,
      slotLabel: view.camera.target.label,
      reportValidationError: setCaptureActionFeedback,
      selectImage,
    }),
    [view.camera.actionVariant, view.camera.disabled, view.camera.target.label, selectImage],
  );
  const tray = useMemo<OcrCaptureTrayView>(
    () => ({
      actionFeedback: captureActionFeedback,
      captureTargetKind,
      selectedImageCount: view.selectedImageCount,
      totalSlotCount: view.totalSlotCount,
      slots: captureSlots.slots,
      clearImage,
      swapImages,
      swapWithAdjacentSlot,
      refreshStatus: captureSlots.refreshStatus,
      selectTarget: selectCaptureTarget,
    }),
    [
      captureActionFeedback,
      captureTargetKind,
      view.selectedImageCount,
      view.totalSlotCount,
      captureSlots.slots,
      clearImage,
      swapImages,
      swapWithAdjacentSlot,
      captureSlots.refreshStatus,
      selectCaptureTarget,
    ],
  );
  const blockedReason = setup.refreshing ? undefined : setup.blockedReason;
  const start = useMemo<OcrCaptureStartView>(
    () => ({
      badgeLabel: view.start.badgeLabel,
      buttonLabel: view.start.buttonLabel,
      description: view.start.description,
      disabled: view.start.disabled,
      blockedReason,
      error: preparationError,
      selectedImageCount: view.selectedImageCount,
      clearAllDisabled: view.clearAllDisabled,
      clearAllImages,
      reviewSubmission,
    }),
    [
      view.start.badgeLabel,
      view.start.buttonLabel,
      view.start.description,
      view.start.disabled,
      blockedReason,
      preparationError,
      view.selectedImageCount,
      view.clearAllDisabled,
      clearAllImages,
      reviewSubmission,
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
