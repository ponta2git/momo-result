import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { InputSource } from "@/features/ocrCapture/captureState";
import {
  buildOcrCaptureView,
  nextEmptyCaptureTarget,
  resolveCaptureTargetChange,
} from "@/features/ocrCapture/ocrCaptureModel";
import { prepareOcrSubmissionPlan } from "@/features/ocrCapture/ocrSubmissionPlan";
import { defaultSetupValues } from "@/features/ocrCapture/schema";
import { useOcrCaptureDraftFlow } from "@/features/ocrCapture/useOcrCaptureDraftFlow";
import { useOcrCaptureMutations } from "@/features/ocrCapture/useOcrCaptureMutations";
import { useOcrSetup } from "@/features/ocrCapture/useOcrSetup";
import { useOcrStartFlow } from "@/features/ocrCapture/useOcrStartFlow";
import { authQueryOptions } from "@/shared/auth/authQueries";
import { useDevUser } from "@/shared/auth/useDevUser";
import type { SlotKind } from "@/shared/domain/ocr";
import { trimSearchParam } from "@/shared/lib/searchParams";

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

  const view = buildOcrCaptureView({
    slots: draftFlow.slots,
    targetKind: captureTargetKind,
    locked: startFlow.locked,
    submitting: captureSubmission.isSubmitting,
    setupReady: setup.resolution.kind === "ready",
  });

  const selectCaptureTarget = (kind: SlotKind) => {
    const selection = resolveCaptureTargetChange(draftFlow.slots, kind);
    if (selection.kind === "blocked") {
      setCaptureActionFeedback(selection.message);
      return;
    }
    setCaptureTargetKind(selection.target);
    setCaptureActionFeedback(undefined);
  };

  const selectImage = (file: File, source: InputSource) => {
    const added = draftFlow.handleAddImage(file, source, captureTargetKind, draftFeedback);
    if (!added) return;

    const nextEmpty = nextEmptyCaptureTarget(draftFlow.slots, captureTargetKind);
    if (nextEmpty) setCaptureTargetKind(nextEmpty);
  };

  const startOcr = () => {
    const preparation = prepareOcrSubmissionPlan({
      setupResolution: setup.resolution,
      blockedReason: setup.blockedReason,
      setupOptions: setup.options,
      slots: draftFlow.slots,
      nowIso: new Date().toISOString(),
    });
    if (preparation.kind === "blocked") {
      setStartError(preparation.message);
      return;
    }
    setStartError(undefined);
    startFlow.open(preparation.plan);
  };

  return {
    startError,
    capture: {
      camera: {
        ...view.camera,
        reportValidationError: draftFeedback.reportFailure,
        selectImage,
      },
      selectedImageCount: view.selectedImageCount,
      totalSlotCount: view.totalSlotCount,
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
        resetDisabled: view.resetDisabled,
        selectTarget: selectCaptureTarget,
        slots: draftFlow.slots,
        statusRefreshing: draftFlow.statusRefreshing,
      },
    },
    navigation: {
      guard: {
        dirty: view.selectedImageCount > 0,
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
        ...view.start,
        blockedReason: setup.blockedReason,
        run: startOcr,
      },
    },
  };
}
