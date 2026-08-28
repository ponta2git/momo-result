import { useCallback, useEffect, useRef, useState } from "react";

import {
  createInitialSlot,
  createInitialSlots,
  releaseSlotResources,
  slotDefinitions,
} from "@/features/ocrCapture/captureState";
import type { CaptureSlotState, InputSource } from "@/features/ocrCapture/captureState";
import { isWorkingStatus, keepImageOnly } from "@/features/ocrCapture/slotPolicy";
import { useOcrJobSlotResource } from "@/features/ocrCapture/useOcrJobSlotResource";
import type { SlotKind } from "@/shared/api/enums";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { bySlot } from "@/shared/lib/slotMap";
import type { SlotMap } from "@/shared/lib/slotMap";

export type OcrCaptureDraftFeedback = {
  reportFailure: (message: string) => void;
  reportSuccess: (message: string) => void;
};

export type OcrCaptureDraftFlow = {
  drafts: SlotMap<OcrDraftResponse>;
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
  slots: CaptureSlotState[];
  statusRefreshing: SlotMap<boolean>;
  updateSlot: (slot: CaptureSlotState) => void;
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
  const resources = [totalAssetsResource, revenueResource, incidentLogResource] as const;
  const slots = resources.map((resource) => resource.slot);
  const drafts = bySlot<OcrDraftResponse>(
    resources.map((resource) => [resource.slot.kind, resource.draft] as const),
  );
  const statusRefreshing = bySlot<boolean>(
    resources.map((resource) => [resource.slot.kind, resource.refreshing] as const),
  );
  const refreshTotalAssets = totalAssetsResource.refresh;
  const refreshRevenue = revenueResource.refresh;
  const refreshIncidentLog = incidentLogResource.refresh;

  useEffect(() => {
    localSlotsRef.current = localSlots;
  }, [localSlots]);

  useEffect(() => {
    return () => {
      for (const slot of localSlotsRef.current) {
        releaseSlotResources(slot);
      }
    };
  }, []);

  const updateSlot = useCallback((nextSlot: CaptureSlotState) => {
    setLocalSlots((current) =>
      current.map((slot) => (slot.kind === nextSlot.kind ? nextSlot : slot)),
    );
  }, []);

  const handleAddImage = useCallback(
    (file: File, source: InputSource, targetKind: SlotKind, feedback: OcrCaptureDraftFeedback) => {
      const targetSlot = slots.find((slot) => slot.kind === targetKind);
      if (!targetSlot) {
        feedback.reportFailure("撮影先を選び直してください。");
        return false;
      }
      if (isWorkingStatus(targetSlot.status)) {
        feedback.reportFailure("読み取り中の分類には画像を配置できません。");
        return false;
      }
      const previewUrl = URL.createObjectURL(file);
      releaseSlotResources(targetSlot);
      const selectedSlot: CaptureSlotState = {
        ...createInitialSlot(targetKind),
        source,
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
    [slots, updateSlot],
  );

  const handleClear = useCallback(
    (kind: SlotKind, feedback: OcrCaptureDraftFeedback) => {
      const currentSlot = slots.find((slot) => slot.kind === kind);
      if (currentSlot) {
        if (isWorkingStatus(currentSlot.status)) {
          feedback.reportFailure(
            "読み取り中の画像は破棄できません。試合一覧で状態を確認してください。",
          );
          return;
        }
        releaseSlotResources(currentSlot);
      }
      setLocalSlots((current) =>
        current.map((slot) => (slot.kind === kind ? createInitialSlot(kind) : slot)),
      );
      feedback.reportSuccess("画像を破棄しました。");
    },
    [slots],
  );

  const handleResetAll = useCallback(
    (feedback: OcrCaptureDraftFeedback) => {
      if (slots.some((slot) => isWorkingStatus(slot.status))) {
        feedback.reportFailure(
          "読み取り中の画像は破棄できません。試合一覧で状態を確認してください。",
        );
        return;
      }
      for (const slot of slots) {
        releaseSlotResources(slot);
      }
      setLocalSlots(createInitialSlots());
      feedback.reportSuccess("画像をすべて破棄しました。次の試合を撮影できます。");
    },
    [slots],
  );

  const handleDropImage = useCallback(
    (sourceKind: SlotKind, targetKind: SlotKind, feedback: OcrCaptureDraftFeedback) => {
      if (sourceKind === targetKind) return;
      const sourceSlot = slots.find((slot) => slot.kind === sourceKind);
      const targetSlot = slots.find((slot) => slot.kind === targetKind);
      if (!sourceSlot || !targetSlot || !sourceSlot.file) return;
      if (isWorkingStatus(sourceSlot.status) || isWorkingStatus(targetSlot.status)) {
        feedback.reportFailure(
          "読み取り中は分類を変更できません。試合一覧で状態を確認してください。",
        );
        return;
      }
      setLocalSlots((current) =>
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
    [slots],
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

  const handleRefreshStatus = useCallback(
    (kind: SlotKind) => {
      switch (kind) {
        case "total_assets":
          refreshTotalAssets();
          break;
        case "revenue":
          refreshRevenue();
          break;
        case "incident_log":
          refreshIncidentLog();
          break;
      }
    },
    [refreshIncidentLog, refreshRevenue, refreshTotalAssets],
  );

  return {
    drafts,
    handleAddImage,
    handleClear,
    handleDropImage,
    handleRefreshStatus,
    handleMoveImage,
    handleResetAll,
    slots,
    statusRefreshing,
    updateSlot,
  };
}
