import { useCallback, useEffect, useRef, useState } from "react";

import { cancelOcrJob } from "@/features/ocrCapture/api";
import type { OcrDraftResponse } from "@/features/ocrCapture/api";
import {
  createInitialSlot,
  createInitialSlots,
  releaseSlotResources,
  slotDefinitions,
} from "@/features/ocrCapture/captureState";
import type { CaptureSlotState, InputSource } from "@/features/ocrCapture/captureState";
import { isWorkingStatus, keepImageOnly } from "@/features/ocrCapture/slotPolicy";
import type { SlotKind } from "@/shared/api/enums";
import type { SlotMap } from "@/shared/lib/slotMap";

export type OcrCaptureDraftFlow = {
  drafts: SlotMap<OcrDraftResponse>;
  handleAddImage: (file: File, source: InputSource, notify: (message: string) => void) => void;
  handleClear: (kind: SlotKind, notify: (message: string) => void) => void;
  handleDropImage: (
    sourceKind: SlotKind,
    targetKind: SlotKind,
    notify: (message: string) => void,
  ) => void;
  handleManualRefresh: (kind: SlotKind) => void;
  handleMoveImage: (
    kind: SlotKind,
    direction: -1 | 1,
    notify: (message: string) => void,
  ) => void;
  handleResetAll: (notify: (message: string) => void) => void;
  setDraft: (kind: SlotKind, draft: OcrDraftResponse) => void;
  slots: CaptureSlotState[];
  updateSlot: (slot: CaptureSlotState) => void;
};

/**
 * 撮影スロット (3 枠) と OCR 下書きの一時状態を所有し、ユーザー操作 (追加/削除/入替/全消去/再描画)
 * を集約する。OCR ジョブ送信や再ポーリングは呼び出し側で扱い、本フックは UI 状態と画像リソース
 * の解放だけに責任を限定する。
 */
export function useOcrCaptureDraftFlow(): OcrCaptureDraftFlow {
  const [slots, setSlots] = useState<CaptureSlotState[]>(() => createInitialSlots());
  const [drafts, setDrafts] = useState<SlotMap<OcrDraftResponse>>({});
  const slotsRef = useRef(slots);

  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  useEffect(() => {
    return () => {
      for (const slot of slotsRef.current) {
        releaseSlotResources(slot);
      }
    };
  }, []);

  const updateSlot = useCallback((nextSlot: CaptureSlotState) => {
    setSlots((current) => current.map((slot) => (slot.kind === nextSlot.kind ? nextSlot : slot)));
  }, []);

  const setDraft = useCallback((kind: SlotKind, draft: OcrDraftResponse) => {
    setDrafts((current) => ({ ...current, [kind]: draft }));
  }, []);

  const handleAddImage = useCallback(
    (file: File, source: InputSource, notify: (message: string) => void) => {
      const targetSlot =
        slotsRef.current.find((slot) => slot.status === "empty") ??
        slotsRef.current.find((slot) => !slot.file && !slot.previewUrl);
      if (!targetSlot) {
        notify("3枚すべて配置済みです。差し替える場合は先に不要な画像を削除してください。");
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      const selectedSlot: CaptureSlotState = {
        ...createInitialSlot(targetSlot.kind),
        source,
        file,
        previewUrl,
        status: "selected",
      };
      updateSlot(selectedSlot);
      setDrafts((current) => {
        const next = { ...current };
        delete next[targetSlot.kind];
        return next;
      });
      const label =
        slotDefinitions.find((definition) => definition.kind === targetSlot.kind)?.label ??
        targetSlot.kind;
      notify(
        `${source === "camera" ? "撮影" : "追加"}した画像を「${label}」へ置きました。必要ならドラッグで並べ替えてください。`,
      );
    },
    [updateSlot],
  );

  const handleClear = useCallback((kind: SlotKind, notify: (message: string) => void) => {
    const currentSlot = slotsRef.current.find((slot) => slot.kind === kind);
    if (currentSlot) {
      releaseSlotResources(currentSlot);
      if (currentSlot.jobId && isWorkingStatus(currentSlot.status)) {
        void cancelOcrJob(currentSlot.jobId).catch(() => undefined);
      }
    }
    setSlots((current) =>
      current.map((slot) => (slot.kind === kind ? createInitialSlot(kind) : slot)),
    );
    setDrafts((current) => {
      const next = { ...current };
      delete next[kind];
      return next;
    });
    notify("画像を削除しました。");
  }, []);

  const handleResetAll = useCallback((notify: (message: string) => void) => {
    for (const slot of slotsRef.current) {
      releaseSlotResources(slot);
      if (slot.jobId && isWorkingStatus(slot.status)) {
        void cancelOcrJob(slot.jobId).catch(() => undefined);
      }
    }
    setSlots(createInitialSlots());
    setDrafts({});
    notify("撮影画像とOCR下書き表示をクリアしました。次の試合を撮影できます。");
  }, []);

  const handleDropImage = useCallback(
    (sourceKind: SlotKind, targetKind: SlotKind, notify: (message: string) => void) => {
      if (sourceKind === targetKind) return;
      const sourceSlot = slotsRef.current.find((slot) => slot.kind === sourceKind);
      const targetSlot = slotsRef.current.find((slot) => slot.kind === targetKind);
      if (!sourceSlot || !targetSlot || !sourceSlot.file) return;
      for (const slot of [sourceSlot, targetSlot]) {
        if (slot.jobId && isWorkingStatus(slot.status)) {
          void cancelOcrJob(slot.jobId).catch(() => undefined);
        }
      }
      setSlots((current) =>
        current.map((slot) => {
          if (slot.kind === sourceKind) return { ...keepImageOnly(targetSlot), kind: sourceKind };
          if (slot.kind === targetKind) return { ...keepImageOnly(sourceSlot), kind: targetKind };
          return slot;
        }),
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[sourceKind];
        delete next[targetKind];
        return next;
      });
      notify("画像の分類を入れ替えました。OCR送信時は移動後の分類名をヒントにします。");
    },
    [],
  );

  const handleMoveImage = useCallback(
    (kind: SlotKind, direction: -1 | 1, notify: (message: string) => void) => {
      const index = slotDefinitions.findIndex((definition) => definition.kind === kind);
      const targetKind = slotDefinitions[index + direction]?.kind;
      if (targetKind) {
        handleDropImage(kind, targetKind, notify);
      }
    },
    [handleDropImage],
  );

  const handleManualRefresh = useCallback((kind: SlotKind) => {
    const currentSlot = slotsRef.current.find((slot) => slot.kind === kind);
    if (!currentSlot) return;
    setSlots((current) =>
      current.map((slot) => (slot.kind === kind ? { ...currentSlot, pollAttempts: 0 } : slot)),
    );
  }, []);

  return {
    drafts,
    handleAddImage,
    handleClear,
    handleDropImage,
    handleManualRefresh,
    handleMoveImage,
    handleResetAll,
    setDraft,
    slots,
    updateSlot,
  };
}
