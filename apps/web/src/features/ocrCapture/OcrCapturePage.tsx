import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelOcrJob, createOcrJob, getOcrDraft, uploadImage } from "@/features/ocrCapture/api";
import type { OcrDraftResponse } from "@/features/ocrCapture/api";
import { CaptureRail } from "@/features/ocrCapture/CaptureRail";
import {
  createInitialSlot,
  createInitialSlots,
  detectedKindFromResponse,
  releaseSlotResources,
  requestedImageTypeForSlot,
  slotDefinitions,
} from "@/features/ocrCapture/captureState";
import type { CaptureSlotState, InputSource } from "@/features/ocrCapture/captureState";
import { buildOcrHints } from "@/features/ocrCapture/hints";
import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
import { ImageInput } from "@/features/ocrCapture/ImageInput";
import { defaultSetupValues } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { SetupPanel } from "@/features/ocrCapture/SetupPanel";
import { useOcrJobPolling } from "@/features/ocrCapture/useOcrJobPolling";
import { DevUserPicker } from "@/shared/auth/DevUserPicker";
import type { SlotKind } from "@/shared/api/enums";
import { parseOcrJobStatus } from "@/shared/api/enums";
import { getAuthMe } from "@/shared/api/client";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { LiveRegion } from "@/shared/ui/LiveRegion";

type SlotWatcherProps = {
  slot: CaptureSlotState;
  onUpdate: (slot: CaptureSlotState) => void;
  onDraft: (kind: SlotKind, draft: OcrDraftResponse) => void;
};

function SlotWatcher({ slot, onUpdate, onDraft }: SlotWatcherProps) {
  const query = useOcrJobPolling({ jobId: slot.jobId, attempts: slot.pollAttempts });
  const handledMarkerRef = useRef("");

  useEffect(() => {
    if (!query.data || !slot.jobId) {
      return;
    }
    const marker = `${slot.jobId}:${query.data.status}:${query.data.updatedAt}:${query.data.draftId ?? ""}`;
    if (handledMarkerRef.current === marker) {
      return;
    }
    handledMarkerRef.current = marker;

    const status = parseOcrJobStatus(query.data.status);
    const nextStatus = status === "unknown" ? slot.status : status;
    onUpdate({
      ...slot,
      status: nextStatus,
      detectedKind: detectedKindFromResponse(query.data.detectedImageType),
      draftId: query.data.draftId,
      jobFailure: query.data.failure,
      pollAttempts: slot.pollAttempts + 1,
    });

    if (status === "succeeded") {
      void getOcrDraft(query.data.draftId).then((draft) => onDraft(slot.kind, draft));
    }
  }, [onDraft, onUpdate, query.data, slot]);

  return null;
}

function isWorkingStatus(status: CaptureSlotState["status"]) {
  return ["uploading", "queueing", "queued", "running"].includes(status);
}

function keepImageOnly(slot: CaptureSlotState): CaptureSlotState {
  if (!slot.file || !slot.previewUrl) {
    return createInitialSlot(slot.kind);
  }
  return {
    ...createInitialSlot(slot.kind),
    source: slot.source,
    file: slot.file,
    previewUrl: slot.previewUrl,
    status: "selected",
  };
}

export function OcrCapturePage() {
  const [setup, setSetup] = useState<SetupFormValues>(defaultSetupValues);
  const [slots, setSlots] = useState<CaptureSlotState[]>(() => createInitialSlots());
  const [drafts, setDrafts] = useState<Partial<Record<SlotKind, OcrDraftResponse>>>({});
  const [notice, setNotice] = useState("");
  const slotsRef = useRef(slots);

  const authQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false,
  });

  const hints = useMemo(
    () => buildOcrHints({ gameTitleId: setup.gameTitleId }),
    [setup.gameTitleId],
  );

  const uploadMutation = useMutation({
    mutationFn: async ({ slot, file }: { slot: CaptureSlotState; file: File }) => {
      const upload = await uploadImage(file);
      const job = await createOcrJob({
        imageId: upload.imageId,
        requestedImageType: requestedImageTypeForSlot(slot),
        ocrHints: hints,
      });
      return { upload, job };
    },
  });

  const updateSlot = useCallback((nextSlot: CaptureSlotState) => {
    setSlots((current) => current.map((slot) => (slot.kind === nextSlot.kind ? nextSlot : slot)));
  }, []);

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

  const setDraft = useCallback((kind: SlotKind, draft: OcrDraftResponse) => {
    setDrafts((current) => ({ ...current, [kind]: draft }));
  }, []);

  function handleAddImage(file: File, source: InputSource) {
    const targetSlot =
      slots.find((slot) => slot.status === "empty") ??
      slots.find((slot) => !slot.file && !slot.previewUrl);
    if (!targetSlot) {
      setNotice("3枚すべて配置済みです。差し替える場合は先に不要な画像を削除してください。");
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
    setNotice(
      `${source === "camera" ? "撮影" : "追加"}した画像を「${slotDefinitions.find((definition) => definition.kind === targetSlot.kind)?.label ?? targetSlot.kind}」へ置きました。必要ならドラッグで並べ替えてください。`,
    );
  }

  async function handleStartOcr() {
    const targetSlots = slots.filter(
      (slot) => slot.file && ["selected", "failed", "cancelled"].includes(slot.status),
    );
    if (targetSlots.length === 0) {
      setNotice("OCRに送る画像がありません。まず撮影して分類トレイへ置いてください。");
      return;
    }

    setNotice(
      `${targetSlots.length}枚をOCRに送信しています。分類トレイ名を画像種別ヒントとして使います。`,
    );
    for (const slot of targetSlots) {
      if (!slot.file) {
        continue;
      }
      const uploadingSlot: CaptureSlotState = {
        ...slot,
        status: "uploading",
        transportError: undefined,
        jobFailure: undefined,
        detectedKind: undefined,
        imageId: undefined,
        jobId: undefined,
        draftId: undefined,
        pollAttempts: 0,
      };
      updateSlot(uploadingSlot);

      try {
        const { upload, job } = await uploadMutation.mutateAsync({
          slot: uploadingSlot,
          file: slot.file,
        });
        const status = parseOcrJobStatus(job.status);
        updateSlot({
          ...uploadingSlot,
          imageId: upload.imageId,
          jobId: job.jobId,
          draftId: job.draftId,
          status: status === "unknown" ? "queued" : status,
        });
      } catch (error) {
        updateSlot({
          ...uploadingSlot,
          status: "failed",
          transportError: normalizeUnknownApiError(error),
        });
      }
    }
    setNotice("OCR依頼を送信しました。完了すると各分類に下書きが表示されます。");
  }

  function handleClear(kind: SlotKind) {
    const currentSlot = slots.find((slot) => slot.kind === kind);
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
    setNotice("画像を削除しました。");
  }

  function handleReset() {
    for (const slot of slots) {
      releaseSlotResources(slot);
      if (slot.jobId && isWorkingStatus(slot.status)) {
        void cancelOcrJob(slot.jobId).catch(() => undefined);
      }
    }
    setSlots(createInitialSlots());
    setDrafts({});
    setNotice("撮影画像とOCR下書き表示をクリアしました。次の試合を撮影できます。");
  }

  function handleDropImage(sourceKind: SlotKind, targetKind: SlotKind) {
    if (sourceKind === targetKind) {
      return;
    }
    const sourceSlot = slots.find((slot) => slot.kind === sourceKind);
    const targetSlot = slots.find((slot) => slot.kind === targetKind);
    if (!sourceSlot || !targetSlot || !sourceSlot.file) {
      return;
    }
    for (const slot of [sourceSlot, targetSlot]) {
      if (slot.jobId && isWorkingStatus(slot.status)) {
        void cancelOcrJob(slot.jobId).catch(() => undefined);
      }
    }

    setSlots((current) =>
      current.map((slot) => {
        if (slot.kind === sourceKind) {
          return { ...keepImageOnly(targetSlot), kind: sourceKind };
        }
        if (slot.kind === targetKind) {
          return { ...keepImageOnly(sourceSlot), kind: targetKind };
        }
        return slot;
      }),
    );
    setDrafts((current) => {
      const next = { ...current };
      delete next[sourceKind];
      delete next[targetKind];
      return next;
    });
    setNotice("画像の分類を入れ替えました。OCR送信時は移動後の分類名をヒントにします。");
  }

  function handleMoveImage(kind: SlotKind, direction: -1 | 1) {
    const index = slotDefinitions.findIndex((definition) => definition.kind === kind);
    const targetKind = slotDefinitions[index + direction]?.kind;
    if (targetKind) {
      handleDropImage(kind, targetKind);
    }
  }

  function handleValidationError(message: string) {
    setNotice(message);
  }

  function handleManualRefresh(kind: SlotKind) {
    const currentSlot = slots.find((slot) => slot.kind === kind);
    if (!currentSlot) {
      return;
    }
    updateSlot({ ...currentSlot, pollAttempts: 0 });
  }

  const authError = authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined;
  const ocrReadyCount = slots.filter(
    (slot) => slot.file && ["selected", "failed", "cancelled"].includes(slot.status),
  ).length;
  const hasWorkingSlot = slots.some((slot) => isWorkingStatus(slot.status));

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
      <LiveRegion message={notice || uploadMutation.status} />
      <header className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-end">
        <div>
          <p className="font-display text-sm tracking-[0.55em] text-rail-gold uppercase">
            Midnight Command Rail
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-6xl">
            桃鉄OCR取り込みコンソール
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-ink-300">
            1つの撮影台で画像を集め、総資産・収益・事件簿の分類トレイへ並べてからOCR下書きを保存します。
          </p>
        </div>
        <DevUserPicker force={authError?.status === 401} />
      </header>

      {authError ? (
        <div
          className="mt-6 rounded-3xl border border-red-300/30 bg-red-950/40 p-4 text-red-50"
          role="alert"
        >
          <strong>{authError.title}</strong>
          <p className="mt-1">
            {authError.status === 403
              ? "DEV_MEMBER_IDS に含まれていないユーザーです。"
              : authError.detail}
          </p>
        </div>
      ) : null}

      <Card className="mt-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[0.3em] text-ink-300 uppercase">Setup</p>
            <h2 className="mt-1 text-2xl font-black">試合コンテキスト</h2>
          </div>
          {authQuery.data ? (
            <p className="text-sm text-ink-300">ログイン中: {authQuery.data.displayName}</p>
          ) : null}
        </div>
        <SetupPanel value={setup} onChange={setSetup} />
      </Card>

      {notice ? (
        <div
          className="mt-6 rounded-3xl border border-rail-gold/25 bg-rail-gold/10 p-4 text-sm text-yellow-50"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      <Card className="mt-8 overflow-hidden">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
          <div>
            <p className="text-xs font-black tracking-[0.3em] text-rail-gold uppercase">
              Capture Deck
            </p>
            <h2 className="mt-1 text-2xl font-black">撮影台</h2>
            <p className="mt-2 text-sm leading-6 text-ink-300">
              撮影すると、空いている分類トレイへ左から順に画像を置きます。順番が違ったら、下の分類トレイでドラッグして入れ替えてください。
            </p>
            <div className="mt-5">
              <CameraCapture
                slotLabel="撮影台"
                onSelect={handleAddImage}
                onValidationError={handleValidationError}
              />
            </div>
          </div>
          <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
            <h3 className="text-lg font-black">次の操作</h3>
            <ol className="mt-3 space-y-3 text-sm leading-6 text-ink-200">
              <li>1. 3枚を撮影して分類トレイへ置く</li>
              <li>2. 画像をドラッグして「総資産 → 収益 → 事件簿」に合わせる</li>
              <li>3. 下のボタンでOCR命令と下書き保存を実行する</li>
            </ol>
            <div className="mt-5 flex flex-wrap gap-2">
              <ImageInput
                slotLabel="撮影台"
                onSelect={handleAddImage}
                onValidationError={handleValidationError}
              />
              <p className="basis-full text-xs text-ink-400">
                ZIPの一括アップロードは別UIで後続実装します。ここは単体画像の退避導線です。
              </p>
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-rail-gold">分類トレイ: 総資産 → 収益 → 事件簿</p>
          <p className="mt-1 text-sm text-ink-300">
            OCR送信時は、画像が置かれているトレイ名を画像種別ヒントとして送ります。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleStartOcr}
            disabled={ocrReadyCount === 0 || hasWorkingSlot || uploadMutation.isPending}
          >
            OCRにかけて下書き保存
          </Button>
          <Button variant="secondary" onClick={handleReset}>
            撮影画像を全消去して次の試合へ
          </Button>
        </div>
      </div>

      <div className="mt-5">
        <CaptureRail
          slots={slots}
          drafts={drafts}
          onClear={handleClear}
          onDropImage={handleDropImage}
          onMoveImage={handleMoveImage}
          onManualRefresh={handleManualRefresh}
        />
      </div>

      {slots.map((slot) => (
        <SlotWatcher key={slot.kind} slot={slot} onUpdate={updateSlot} onDraft={setDraft} />
      ))}
    </main>
  );
}
