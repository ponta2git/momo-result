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
} from "@/features/ocrCapture/captureState";
import type { CaptureSlotState, InputSource } from "@/features/ocrCapture/captureState";
import { buildOcrHints } from "@/features/ocrCapture/hints";
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

  useEffect(() => {
    if (!query.data || !slot.jobId) {
      return;
    }

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

  async function handleSelect(kind: SlotKind, file: File, source: InputSource) {
    const currentSlot = slots.find((slot) => slot.kind === kind);
    if (!currentSlot) {
      return;
    }

    releaseSlotResources(currentSlot);
    if (currentSlot.jobId) {
      void cancelOcrJob(currentSlot.jobId).catch(() => undefined);
    }
    const previewUrl = URL.createObjectURL(file);
    const selectedSlot: CaptureSlotState = {
      ...createInitialSlot(kind),
      forcedKind: currentSlot.forcedKind,
      source,
      file,
      previewUrl,
      status: "uploading",
    };
    updateSlot(selectedSlot);

    try {
      const { upload, job } = await uploadMutation.mutateAsync({ slot: selectedSlot, file });
      const status = parseOcrJobStatus(job.status);
      updateSlot({
        ...selectedSlot,
        imageId: upload.imageId,
        jobId: job.jobId,
        draftId: job.draftId,
        status: status === "unknown" ? "queued" : status,
      });
    } catch (error) {
      updateSlot({
        ...selectedSlot,
        status: "failed",
        transportError: normalizeUnknownApiError(error),
      });
    }
  }

  function handleClear(kind: SlotKind) {
    const currentSlot = slots.find((slot) => slot.kind === kind);
    if (currentSlot) {
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
  }

  function handleReset() {
    for (const slot of slots) {
      releaseSlotResources(slot);
    }
    setSlots(createInitialSlots());
    setDrafts({});
    setNotice("スロットをリセットしました。");
  }

  function handleForceKind(kind: SlotKind) {
    setSlots((current) =>
      current.map((slot) =>
        slot.kind === kind ? { ...slot, forcedKind: !slot.forcedKind } : slot,
      ),
    );
  }

  function handleValidationError(kind: SlotKind, message: string) {
    const currentSlot = slots.find((slot) => slot.kind === kind) ?? createInitialSlot(kind);
    updateSlot({
      ...currentSlot,
      status: "failed",
      transportError: {
        kind: "api",
        title: "画像を投入できません",
        detail: message,
      },
    });
  }

  function handleManualRefresh(kind: SlotKind) {
    const currentSlot = slots.find((slot) => slot.kind === kind);
    if (!currentSlot) {
      return;
    }
    updateSlot({ ...currentSlot, pollAttempts: 0 });
  }

  const authError = authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined;

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
            作品ヒントと固定4名のエイリアスを添えて、総資産・収益・事件簿の3枚を台本順にOCRへ流します。
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

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-rail-gold">撮影順: 総資産 → 収益 → 事件簿</p>
          <p className="mt-1 text-sm text-ink-300">
            アップロードは自動判別、ブラウザ撮影はスロット種別をヒント送信します。
          </p>
        </div>
        <Button variant="secondary" onClick={handleReset}>
          新しい試合を始める
        </Button>
      </div>

      <div className="mt-5">
        <CaptureRail
          slots={slots}
          drafts={drafts}
          onSelect={handleSelect}
          onClear={handleClear}
          onForceKind={handleForceKind}
          onValidationError={handleValidationError}
          onManualRefresh={handleManualRefresh}
        />
      </div>

      {slots.map((slot) => (
        <SlotWatcher key={slot.kind} slot={slot} onUpdate={updateSlot} onDraft={setDraft} />
      ))}
    </main>
  );
}
