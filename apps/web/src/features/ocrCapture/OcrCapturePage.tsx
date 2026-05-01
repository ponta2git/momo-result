import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { cancelOcrJob, createOcrJob, getOcrDraft, uploadImage } from "@/features/ocrCapture/api";
import type { OcrDraftResponse } from "@/features/ocrCapture/api";
import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
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
import { ImageInput } from "@/features/ocrCapture/ImageInput";
import { defaultSetupValues } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { SetupPanel } from "@/features/ocrCapture/SetupPanel";
import { useOcrJobPolling } from "@/features/ocrCapture/useOcrJobPolling";
import { getAuthMe } from "@/shared/api/client";
import type { SlotKind } from "@/shared/api/enums";
import { parseLayoutFamily, parseOcrJobStatus } from "@/shared/api/enums";
import { listGameTitles } from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { AuthPanel } from "@/shared/auth/AuthPanel";
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
  const navigate = useNavigate();
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
  const authReady = authQuery.isSuccess;
  const authMemberId = authQuery.data?.memberId;

  const gameTitlesQuery = useQuery({
    queryKey: ["masters", "game-titles", authMemberId ?? "anonymous"],
    queryFn: listGameTitles,
    enabled: authReady,
  });

  const hints = useMemo(() => {
    const selected = gameTitlesQuery.data?.items?.find((item) => item.id === setup.gameTitleId);
    const input: { gameTitleName?: string; layoutFamily?: "momotetsu_2" | "world" | "reiwa" } = {};
    if (selected?.name) input.gameTitleName = selected.name;
    const lf = parseLayoutFamily(selected?.layoutFamily);
    if (lf) input.layoutFamily = lf;
    return buildOcrHints(input);
  }, [gameTitlesQuery.data, setup.gameTitleId]);

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
        try {
          const draft = await getOcrDraft(job.draftId);
          setDraft(slot.kind, draft);
        } catch (error) {
          updateSlot({
            ...uploadingSlot,
            imageId: upload.imageId,
            jobId: job.jobId,
            draftId: job.draftId,
            status: status === "unknown" ? "queued" : status,
            transportError: normalizeUnknownApiError(error),
          });
        }
      } catch (error) {
        updateSlot({
          ...uploadingSlot,
          status: "failed",
          transportError: normalizeUnknownApiError(error),
        });
      }
    }
    setNotice(
      "OCR依頼を送信し、手入力用の下書きを保存しました。ワーカー未接続でも「下書きを確認する」から確認画面へ進めます。",
    );
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
  const draftCount = Object.keys(drafts).length;

  function handleReviewDrafts() {
    const params = new URLSearchParams();
    if (drafts.total_assets?.draftId) params.set("totalAssets", drafts.total_assets.draftId);
    if (drafts.revenue?.draftId) params.set("revenue", drafts.revenue.draftId);
    if (drafts.incident_log?.draftId) params.set("incidentLog", drafts.incident_log.draftId);
    navigate(`/review/${Date.now().toString(36)}?${params.toString()}`);
  }

  function handleSampleReview() {
    navigate(`/review/dev-sample?sample=1`);
  }

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
      <LiveRegion message={notice || uploadMutation.status} />
      <header className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-end">
        <div>
          <p className="font-display text-rail-gold text-sm tracking-[0.55em] uppercase">
            Result Capture Desk
          </p>
          <h1 className="text-ink-100 mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">
            桃鉄OCR取り込みコンソール
          </h1>
          <p className="text-ink-300 mt-4 max-w-2xl text-base leading-7">
            1つの撮影台で画像を集め、総資産・収益・事件簿の分類トレイへ並べてからOCR下書きを保存します。
          </p>
        </div>
        <AuthPanel auth={authQuery.data} forceDevPicker={authError?.status === 401} />
      </header>

      <nav
        className="border-line-soft bg-night-900/58 mt-8 rounded-[1.75rem] border px-4 py-3"
        aria-label="OCR取り込みの流れ"
      >
        <ol className="text-ink-200 grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["01", "撮影台", "キャプチャーボードから静止画を作る"],
            ["02", "分類トレイ", "3枚を正しいホームへ並べる"],
            ["03", "OCR下書き", "明示ボタンで保存する"],
          ].map(([step, title, description]) => (
            <li key={step} className="flex items-center gap-3">
              <span className="border-line-strong bg-rail-gold/10 font-display text-rail-gold grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs">
                {step}
              </span>
              <span>
                <span className="text-ink-100 block font-bold">{title}</span>
                <span className="text-ink-400 block text-xs">{description}</span>
              </span>
            </li>
          ))}
        </ol>
      </nav>

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
            <p className="text-ink-300 text-xs font-bold tracking-[0.3em] uppercase">
              Match Context
            </p>
            <h2 className="mt-1 text-2xl font-black">試合コンテキスト</h2>
          </div>
          {authQuery.data ? (
            <p className="text-ink-300 text-sm">ログイン中: {authQuery.data.displayName}</p>
          ) : null}
        </div>
        <SetupPanel
          value={setup}
          onChange={setSetup}
          enabled={authReady}
          authMemberId={authMemberId}
        />
      </Card>

      {notice ? (
        <div
          className="border-rail-gold/25 bg-rail-gold/10 mt-6 rounded-3xl border p-4 text-sm text-yellow-50"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      <Card className="mt-8 overflow-hidden">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
          <div>
            <p className="text-rail-gold text-xs font-black tracking-[0.3em] uppercase">
              Capture Deck
            </p>
            <h2 className="mt-1 text-2xl font-black">撮影台</h2>
            <p className="text-ink-300 mt-2 text-sm leading-6">
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
          <div className="border-line-soft bg-capture-black/34 rounded-[1.5rem] border p-4">
            <h3 className="text-lg font-black">運転手順</h3>
            <ol className="text-ink-200 mt-4 space-y-4 text-sm leading-6">
              {[
                ["撮影", "3枚を撮影して分類トレイへ置く"],
                ["入替", "画像をドラッグして総資産 → 収益 → 事件簿に合わせる"],
                ["保存", "OCR命令と下書き保存を明示実行する"],
              ].map(([label, text]) => (
                <li key={label} className="grid grid-cols-[3.5rem_1fr] gap-3">
                  <span className="border-rail-gold/30 bg-rail-gold/10 text-rail-gold rounded-full border px-3 py-1 text-center text-xs font-bold">
                    {label}
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap gap-2">
              <ImageInput
                slotLabel="撮影台"
                onSelect={handleAddImage}
                onValidationError={handleValidationError}
              />
              <p className="text-ink-400 basis-full text-xs">
                ZIPの一括アップロードは別UIで後続実装します。ここは単体画像の退避導線です。
              </p>
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-rail-gold text-sm font-bold">分類トレイ: 総資産 → 収益 → 事件簿</p>
          <p className="text-ink-300 mt-1 text-sm">
            OCR送信時は、画像が置かれているトレイ名を画像種別ヒントとして送ります。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="border-line-soft bg-night-900/72 text-ink-200 rounded-full border px-3 py-2 text-sm font-bold">
            OCR待ち {ocrReadyCount}/3
          </span>
          <Button
            onClick={handleStartOcr}
            disabled={ocrReadyCount === 0 || hasWorkingSlot || uploadMutation.isPending}
          >
            OCRにかけて下書き保存
          </Button>
          <Button variant="secondary" onClick={handleReviewDrafts} disabled={draftCount === 0}>
            下書きを確認する
          </Button>
          {import.meta.env.DEV ? (
            <Button variant="secondary" onClick={handleSampleReview}>
              サンプル下書きで確認
            </Button>
          ) : null}
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
