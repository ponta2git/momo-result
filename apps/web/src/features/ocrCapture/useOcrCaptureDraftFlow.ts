import { useCallback, useEffect, useRef, useState } from "react";

import {
  createInitialSlot,
  createInitialSlots,
  releaseSlotResources,
  slotDefinitions,
} from "@/features/ocrCapture/captureState";
import type { CaptureSlotState, InputSource } from "@/features/ocrCapture/captureState";
import { isWorkingStatus, keepImageOnly } from "@/features/ocrCapture/slotPolicy";
import type { SlotKind } from "@/shared/api/enums";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { SlotMap } from "@/shared/lib/slotMap";

export type OcrCaptureDraftFlow = {
  drafts: SlotMap<OcrDraftResponse>;
  handleAddImage: (
    file: File,
    source: InputSource,
    targetKind: SlotKind,
    notify: (message: string) => void,
  ) => boolean;
  handleClear: (kind: SlotKind, notify: (message: string) => void) => void;
  handleDropImage: (
    sourceKind: SlotKind,
    targetKind: SlotKind,
    notify: (message: string) => void,
  ) => void;
  handleRefreshStatus: (kind: SlotKind) => void;
  handleMoveImage: (kind: SlotKind, direction: -1 | 1, notify: (message: string) => void) => void;
  handleResetAll: (notify: (message: string) => void) => void;
  setDraft: (kind: SlotKind, draft: OcrDraftResponse) => void;
  setStatusRefreshPending: (kind: SlotKind, pending: boolean) => void;
  slots: CaptureSlotState[];
  updateSlot: (slot: CaptureSlotState) => void;
};

/**
 * 撮影スロット (3 枠) と OCR 下書きの一時状態を所有し、ユーザー操作 (追加/削除/入替/全消去/状態更新)
 * を集約する。OCR ジョブ送信や明示的な状態更新は呼び出し側で扱い、本フックは UI 状態と画像リソース
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

  const setStatusRefreshPending = useCallback((kind: SlotKind, pending: boolean) => {
    setSlots((current) =>
      current.map((slot) =>
        slot.kind === kind && slot.statusRefreshPending !== pending
          ? { ...slot, statusRefreshPending: pending }
          : slot,
      ),
    );
  }, []);

  const handleAddImage = useCallback(
    (file: File, source: InputSource, targetKind: SlotKind, notify: (message: string) => void) => {
      const targetSlot = slotsRef.current.find((slot) => slot.kind === targetKind);
      if (!targetSlot) {
        notify("撮影先を選び直してください。");
        return false;
      }
      if (isWorkingStatus(targetSlot.status)) {
        notify("読み取り中の分類には画像を配置できません。");
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
      setDrafts((current) => {
        const next = { ...current };
        delete next[targetKind];
        return next;
      });
      const label =
        slotDefinitions.find((definition) => definition.kind === targetKind)?.label ?? targetKind;
      notify(`${label}に${source === "camera" ? "撮影画像" : "画像"}を配置しました。`);
      return true;
    },
    [updateSlot],
  );

  const handleClear = useCallback((kind: SlotKind, notify: (message: string) => void) => {
    const currentSlot = slotsRef.current.find((slot) => slot.kind === kind);
    if (currentSlot) {
      if (isWorkingStatus(currentSlot.status)) {
        notify("読み取り中の画像は削除できません。試合一覧で状態を確認してください。");
        return;
      }
      releaseSlotResources(currentSlot);
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
    if (slotsRef.current.some((slot) => isWorkingStatus(slot.status))) {
      notify("読み取り中の画像は削除できません。試合一覧で状態を確認してください。");
      return;
    }
    for (const slot of slotsRef.current) {
      releaseSlotResources(slot);
    }
    setSlots(createInitialSlots());
    setDrafts({});
    notify("画像をすべて削除しました。次の試合を撮影できます。");
  }, []);

  const handleDropImage = useCallback(
    (sourceKind: SlotKind, targetKind: SlotKind, notify: (message: string) => void) => {
      if (sourceKind === targetKind) return;
      const sourceSlot = slotsRef.current.find((slot) => slot.kind === sourceKind);
      const targetSlot = slotsRef.current.find((slot) => slot.kind === targetKind);
      if (!sourceSlot || !targetSlot || !sourceSlot.file) return;
      if (isWorkingStatus(sourceSlot.status) || isWorkingStatus(targetSlot.status)) {
        notify("読み取り中は分類を変更できません。試合一覧で状態を確認してください。");
        return;
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
      notify("画像の分類を入れ替えました。読み取り時は移動後の分類として扱います。");
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

  const handleRefreshStatus = useCallback((kind: SlotKind) => {
    setSlots((current) =>
      current.map((slot) => {
        if (slot.kind !== kind || slot.statusRefreshPending) {
          return slot;
        }
        return {
          ...slot,
          statusRefreshPending: true,
          statusRefreshRequest: (slot.statusRefreshRequest ?? 0) + 1,
          transportError: undefined,
        };
      }),
    );
  }, []);

  return {
    drafts,
    handleAddImage,
    handleClear,
    handleDropImage,
    handleRefreshStatus,
    handleMoveImage,
    handleResetAll,
    setDraft,
    setStatusRefreshPending,
    slots,
    updateSlot,
  };
}
