import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { buildCaptureSlotView } from "@/features/ocrCapture/captureSlotView";
import type { CaptureSlotView } from "@/features/ocrCapture/captureSlotView";
import {
  createInitialSlot,
  createInitialSlots,
  releaseSlotResources,
  slotDefinitions,
} from "@/features/ocrCapture/captureState";
import type { CaptureSlotState, InputSource } from "@/features/ocrCapture/captureState";
import {
  buildOcrCaptureView,
  nextEmptyCaptureTarget,
  resolveCaptureTargetChange,
} from "@/features/ocrCapture/ocrCaptureModel";
import { prepareOcrSubmissionPlan } from "@/features/ocrCapture/ocrSubmissionPlan";
import type { OcrSlotReceipt } from "@/features/ocrCapture/ocrSubmissionWorkflow";
import {
  applyOcrSlotReceipt,
  captureSlotCapabilities,
  isWorkingStatus,
  keepImageOnly,
} from "@/features/ocrCapture/slotPolicy";
import { useOcrJobSlotResource } from "@/features/ocrCapture/useOcrJobSlotResource";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import type { SlotKind } from "@/shared/domain/ocr";

export type OcrCaptureDraftFeedback = {
  reportFailure: (message: string) => void;
  reportSuccess: (message: string) => void;
};

export type OcrCaptureDraftFlow = {
  handleAddImage: (
    file: File,
    source: InputSource,
    targetKind: SlotKind,
    feedback: OcrCaptureDraftFeedback,
  ) => boolean;
  handleClear: (kind: SlotKind, feedback: OcrCaptureDraftFeedback) => void;
  handleDropImage: (
    sourceKind: SlotKind,
    targetKind: SlotKind,
    feedback: OcrCaptureDraftFeedback,
  ) => void;
  handleRefreshStatus: (kind: SlotKind) => void;
  handleMoveImage: (kind: SlotKind, direction: -1 | 1, feedback: OcrCaptureDraftFeedback) => void;
  handleResetAll: (feedback: OcrCaptureDraftFeedback) => void;
  slots: readonly CaptureSlotView[];
  applyReceipt: (receipt: OcrSlotReceipt) => void;
  prepareSubmission: (
    input: Omit<Parameters<typeof prepareOcrSubmissionPlan>[0], "slots">,
  ) => ReturnType<typeof prepareOcrSubmissionPlan>;
  buildView: (
    input: Omit<Parameters<typeof buildOcrCaptureView>[0], "slots">,
  ) => ReturnType<typeof buildOcrCaptureView>;
  selectTarget: (kind: SlotKind) => ReturnType<typeof resolveCaptureTargetChange>;
  nextEmptyTarget: (current: SlotKind) => SlotKind | undefined;
};

type OcrCaptureDraftFlowInput = {
  onDraftLoadError?: ((error: NormalizedApiError) => void) | undefined;
};

function requireSlot(slots: readonly CaptureSlotState[], kind: SlotKind): CaptureSlotState {
  const slot = slots.find((candidate) => candidate.kind === kind);
  if (!slot) throw new Error(`Missing OCR capture slot: ${kind}`);
  return slot;
}

/**
 * 撮影スロット (3 枠) の画像リソースと、各スロットに対応する OCR job/draft query lifecycleを所有する。
 * local slotには画像と送信識別子だけを保持し、表示用status/draft/error/pendingはqueryから直接導出する。
 */
export function useOcrCaptureDraftFlow({
  onDraftLoadError,
}: OcrCaptureDraftFlowInput = {}): OcrCaptureDraftFlow {
  const [localSlots, setLocalSlots] = useState<CaptureSlotState[]>(() => createInitialSlots());
  const localSlotsRef = useRef(localSlots);
  const totalAssetsResource = useOcrJobSlotResource(
    requireSlot(localSlots, "total_assets"),
    onDraftLoadError,
  );
  const revenueResource = useOcrJobSlotResource(
    requireSlot(localSlots, "revenue"),
    onDraftLoadError,
  );
  const incidentLogResource = useOcrJobSlotResource(
    requireSlot(localSlots, "incident_log"),
    onDraftLoadError,
  );
  const slots = useMemo(
    () => [totalAssetsResource.slot, revenueResource.slot, incidentLogResource.slot],
    [totalAssetsResource.slot, revenueResource.slot, incidentLogResource.slot],
  );
  const totalAssetsView = useCaptureSlotView(totalAssetsResource);
  const revenueView = useCaptureSlotView(revenueResource);
  const incidentLogView = useCaptureSlotView(incidentLogResource);
  const slotViews = useMemo(
    () => [totalAssetsView, revenueView, incidentLogView],
    [totalAssetsView, revenueView, incidentLogView],
  );
  const resourceSnapshot = useRef({
    localSlots,
    slots,
    refreshTotalAssets: totalAssetsResource.refresh,
    refreshRevenue: revenueResource.refresh,
    refreshIncidentLog: incidentLogResource.refresh,
  });
  useLayoutEffect(() => {
    resourceSnapshot.current = {
      localSlots,
      slots,
      refreshTotalAssets: totalAssetsResource.refresh,
      refreshRevenue: revenueResource.refresh,
      refreshIncidentLog: incidentLogResource.refresh,
    };
  }, [
    localSlots,
    slots,
    totalAssetsResource.refresh,
    revenueResource.refresh,
    incidentLogResource.refresh,
  ]);
  // Commands read the latest owned images, including replacements before React commits.
  // Query-derived status is valid only for the exact local slot used to resolve it.
  const readSlots = useCallback(() => {
    const resource = resourceSnapshot.current;
    return localSlotsRef.current.map((slot, index) =>
      resource.localSlots[index] === slot ? (resource.slots[index] ?? slot) : slot,
    );
  }, []);

  useEffect(() => {
    return () => {
      for (const slot of localSlotsRef.current) {
        releaseSlotResources(slot);
      }
    };
  }, []);

  // Commands own the URLs immediately, including images replaced or abandoned before a commit.
  // Keep cleanup outside React state updaters, which Strict Mode may invoke more than once.
  const updateLocalSlots = useCallback(
    (update: (current: CaptureSlotState[]) => CaptureSlotState[]) => {
      const current = localSlotsRef.current;
      const next = update(current);
      for (const slot of current) {
        if (
          slot.previewUrl &&
          !next.some((candidate) => candidate.previewUrl === slot.previewUrl)
        ) {
          releaseSlotResources(slot);
        }
      }
      localSlotsRef.current = next;
      setLocalSlots(next);
    },
    [],
  );

  const updateSlot = useCallback(
    (nextSlot: CaptureSlotState) => {
      updateLocalSlots((current) =>
        current.map((slot) => (slot.kind === nextSlot.kind ? nextSlot : slot)),
      );
    },
    [updateLocalSlots],
  );

  const applyReceipt = useCallback(
    (receipt: OcrSlotReceipt) => {
      updateLocalSlots((current) => current.map((slot) => applyOcrSlotReceipt(slot, receipt)));
    },
    [updateLocalSlots],
  );

  const handleAddImage = useCallback(
    (file: File, source: InputSource, targetKind: SlotKind, feedback: OcrCaptureDraftFeedback) => {
      const targetSlot = readSlots().find((slot) => slot.kind === targetKind);
      if (!targetSlot) {
        feedback.reportFailure("撮影先を選び直してください。");
        return false;
      }
      if (!captureSlotCapabilities(targetSlot).canSelect) {
        feedback.reportFailure("読み取り中の分類には画像を配置できません。");
        return false;
      }
      const previewUrl = URL.createObjectURL(file);
      const selectedSlot: CaptureSlotState = {
        ...createInitialSlot(targetKind),
        source,
        selectionId: crypto.randomUUID(),
        file,
        previewUrl,
        status: "selected",
      };
      updateSlot(selectedSlot);
      const label =
        slotDefinitions.find((definition) => definition.kind === targetKind)?.label ?? targetKind;
      feedback.reportSuccess(
        `${label}に${source === "camera" ? "撮影画像" : "画像"}を配置しました。`,
      );
      return true;
    },
    [readSlots, updateSlot],
  );

  const handleClear = useCallback(
    (kind: SlotKind, feedback: OcrCaptureDraftFeedback) => {
      const currentSlot = readSlots().find((slot) => slot.kind === kind);
      if (currentSlot && isWorkingStatus(currentSlot.status)) {
        feedback.reportFailure(
          "読み取り中の画像は破棄できません。試合一覧で状態を確認してください。",
        );
        return;
      }
      updateLocalSlots((current) =>
        current.map((slot) => (slot.kind === kind ? createInitialSlot(kind) : slot)),
      );
      feedback.reportSuccess("画像を破棄しました。");
    },
    [readSlots, updateLocalSlots],
  );

  const handleResetAll = useCallback(
    (feedback: OcrCaptureDraftFeedback) => {
      if (readSlots().some((slot) => isWorkingStatus(slot.status))) {
        feedback.reportFailure(
          "読み取り中の画像は破棄できません。試合一覧で状態を確認してください。",
        );
        return;
      }
      updateLocalSlots(createInitialSlots);
      feedback.reportSuccess("画像をすべて破棄しました。次の試合を撮影できます。");
    },
    [readSlots, updateLocalSlots],
  );

  const handleDropImage = useCallback(
    (sourceKind: SlotKind, targetKind: SlotKind, feedback: OcrCaptureDraftFeedback) => {
      if (sourceKind === targetKind) return;
      const currentSlots = readSlots();
      const sourceSlot = currentSlots.find((slot) => slot.kind === sourceKind);
      const targetSlot = currentSlots.find((slot) => slot.kind === targetKind);
      if (!sourceSlot || !targetSlot || !sourceSlot.file) return;
      if (isWorkingStatus(sourceSlot.status) || isWorkingStatus(targetSlot.status)) {
        feedback.reportFailure(
          "読み取り中は分類を変更できません。試合一覧で状態を確認してください。",
        );
        return;
      }
      updateLocalSlots((current) =>
        current.map((slot) => {
          if (slot.kind === sourceKind) return { ...keepImageOnly(targetSlot), kind: sourceKind };
          if (slot.kind === targetKind) return { ...keepImageOnly(sourceSlot), kind: targetKind };
          return slot;
        }),
      );
      const sourceLabel =
        slotDefinitions.find((definition) => definition.kind === sourceKind)?.label ?? sourceKind;
      const targetLabel =
        slotDefinitions.find((definition) => definition.kind === targetKind)?.label ?? targetKind;
      feedback.reportSuccess(`${sourceLabel}と${targetLabel}の画像を入れ替えました。`);
    },
    [readSlots, updateLocalSlots],
  );

  const handleMoveImage = useCallback(
    (kind: SlotKind, direction: -1 | 1, feedback: OcrCaptureDraftFeedback) => {
      const index = slotDefinitions.findIndex((definition) => definition.kind === kind);
      const targetKind = slotDefinitions[index + direction]?.kind;
      if (targetKind) {
        handleDropImage(kind, targetKind, feedback);
      }
    },
    [handleDropImage],
  );

  const handleRefreshStatus = useCallback((kind: SlotKind) => {
    const resource = resourceSnapshot.current;
    switch (kind) {
      case "total_assets":
        resource.refreshTotalAssets();
        break;
      case "revenue":
        resource.refreshRevenue();
        break;
      case "incident_log":
        resource.refreshIncidentLog();
        break;
    }
  }, []);
  const prepareSubmission = useCallback<OcrCaptureDraftFlow["prepareSubmission"]>(
    (input) => prepareOcrSubmissionPlan({ ...input, slots: readSlots() }),
    [readSlots],
  );
  const buildView = useCallback<OcrCaptureDraftFlow["buildView"]>(
    (input) => buildOcrCaptureView({ ...input, slots }),
    [slots],
  );
  const selectTarget = useCallback(
    (kind: SlotKind) => resolveCaptureTargetChange(readSlots(), kind),
    [readSlots],
  );
  const nextEmptyTarget = useCallback(
    (current: SlotKind) => nextEmptyCaptureTarget(readSlots(), current),
    [readSlots],
  );

  return {
    handleAddImage,
    handleClear,
    handleDropImage,
    handleRefreshStatus,
    handleMoveImage,
    handleResetAll,
    slots: slotViews,
    applyReceipt,
    prepareSubmission,
    buildView,
    selectTarget,
    nextEmptyTarget,
  };
}

function useCaptureSlotView(resource: ReturnType<typeof useOcrJobSlotResource>) {
  const { slot, draft, refreshing } = resource;
  return useMemo(() => buildCaptureSlotView(slot, draft, refreshing), [slot, draft, refreshing]);
}
