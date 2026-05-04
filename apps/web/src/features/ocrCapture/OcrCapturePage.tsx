import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  cancelMatchDraft,
  cancelOcrJob,
  createMatchDraft,
  createOcrJob,
  getOcrDraft,
  uploadImage,
} from "@/features/ocrCapture/api";
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
import { defaultSetupValues, setupSchema } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { SetupPanel } from "@/features/ocrCapture/SetupPanel";
import { useOcrJobPolling } from "@/features/ocrCapture/useOcrJobPolling";
import { getAuthMe } from "@/shared/api/client";
import type { SlotKind } from "@/shared/api/enums";
import { parseLayoutFamily, parseOcrJobStatus } from "@/shared/api/enums";
import { listGameTitles } from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { AuthPanel } from "@/shared/auth/AuthPanel";
import { Button } from "@/shared/ui/actions/Button";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Notice } from "@/shared/ui/feedback/Notice";
import { showToast } from "@/shared/ui/feedback/Toast";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

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

const panelClass =
  "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4";

const panelTitleClass = "text-lg font-semibold text-[var(--color-text-primary)]";

const panelLeadClass = "mt-1 text-sm leading-6 text-[var(--color-text-secondary)]";

const linkButtonClass =
  "inline-flex min-h-10 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)]";

export function OcrCapturePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
    mutationFn: async ({
      matchDraftId,
      slot,
      file,
    }: {
      file: File;
      matchDraftId: string;
      slot: CaptureSlotState;
    }) => {
      const upload = await uploadImage(file);
      const job = await createOcrJob({
        imageId: upload.imageId,
        matchDraftId,
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

  function notify(message: string) {
    setNotice(message);
    showToast({ title: message, tone: "info" });
  }

  function handleAddImage(file: File, source: InputSource) {
    const targetSlot =
      slots.find((slot) => slot.status === "empty") ??
      slots.find((slot) => !slot.file && !slot.previewUrl);
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
    notify(
      `${source === "camera" ? "撮影" : "追加"}した画像を「${slotDefinitions.find((definition) => definition.kind === targetSlot.kind)?.label ?? targetSlot.kind}」へ置きました。必要ならドラッグで並べ替えてください。`,
    );
  }

  async function handleStartOcr() {
    const targetSlots = slots.filter(
      (slot) => slot.file && ["selected", "failed", "cancelled"].includes(slot.status),
    );
    if (targetSlots.length === 0) {
      notify("OCRに送る画像がありません。まず撮影して分類トレイへ置いてください。");
      return;
    }
    const setupSubmission = setupSchema.safeParse(setup);
    if (!setupSubmission.success) {
      notify(setupSubmission.error.issues[0]?.message ?? "試合コンテキストを確認してください。");
      return;
    }

    const selectedGameTitle = gameTitlesQuery.data?.items?.find(
      (item) => item.id === setup.gameTitleId,
    );

    notify(
      `${targetSlots.length}枚をOCRに送信しています。作業単位を作成して、試合一覧でOCR中として追跡します。`,
    );
    let matchDraftId = "";
    try {
      const matchDraft = await createMatchDraft({
        gameTitleId: setup.gameTitleId,
        ...(selectedGameTitle?.layoutFamily
          ? { layoutFamily: selectedGameTitle.layoutFamily }
          : {}),
        mapMasterId: setup.mapMasterId,
        ownerMemberId: setup.ownerMemberId,
        playedAt: new Date().toISOString(),
        seasonMasterId: setup.seasonMasterId,
        status: "ocr_running",
      });
      matchDraftId = matchDraft.matchDraftId;
    } catch (error) {
      const normalized = normalizeUnknownApiError(error);
      notify(normalized.detail || normalized.title);
      return;
    }

    let createdJobCount = 0;
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
          matchDraftId,
          slot: uploadingSlot,
          file: slot.file,
        });
        createdJobCount += 1;
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
    if (createdJobCount > 0) {
      await queryClient.invalidateQueries({ queryKey: ["matches"] });
      navigate("/matches", { replace: true });
      return;
    }

    void cancelMatchDraft(matchDraftId).catch(() => undefined);
    notify("OCRジョブを作成できませんでした。画像と試合コンテキストを確認してください。");
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
    notify("画像を削除しました。");
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
    notify("撮影画像とOCR下書き表示をクリアしました。次の試合を撮影できます。");
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
    notify("画像の分類を入れ替えました。OCR送信時は移動後の分類名をヒントにします。");
  }

  function handleMoveImage(kind: SlotKind, direction: -1 | 1) {
    const index = slotDefinitions.findIndex((definition) => definition.kind === kind);
    const targetKind = slotDefinitions[index + direction]?.kind;
    if (targetKind) {
      handleDropImage(kind, targetKind);
    }
  }

  function handleValidationError(message: string) {
    notify(message);
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
  const selectedSlotLabels = slotDefinitions
    .filter((definition) =>
      slots.some(
        (slot) =>
          slot.kind === definition.kind &&
          slot.file &&
          ["selected", "failed", "cancelled"].includes(slot.status),
      ),
    )
    .map((definition) => definition.label);

  return (
    <div className="grid gap-5">
      <LiveRegion message={notice || uploadMutation.status} />
      <PageHeader
        eyebrow="OCR"
        title="OCR取り込み"
        description="試合を選び、画像を分類して、OCRジョブだけを開始します。結果待ちは試合一覧で扱います。"
        actions={
          <Link className={linkButtonClass} to="/matches">
            試合一覧へ戻る
          </Link>
        }
      />

      {authError ? (
        <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/8 p-4 md:grid-cols-[1fr_18rem] md:items-center">
          <Notice className="border-0 bg-transparent p-0" tone="danger" title={authError.title}>
            <p>
              {authError.status === 403
                ? "DEV_MEMBER_IDS に含まれていないユーザーです。"
                : authError.detail}
            </p>
          </Notice>
          <AuthPanel auth={authQuery.data} forceDevPicker={authError.status === 401} />
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,0.44fr)]">
        <div className={panelClass}>
          <div className="mb-4">
            <h2 className={panelTitleClass}>試合設定</h2>
            <p className={panelLeadClass}>OCR profileと後続の確認画面で使う最小情報です。</p>
          </div>
          <SetupPanel
            value={setup}
            onChange={setSetup}
            enabled={authReady}
            authMemberId={authMemberId}
          />
        </div>

        <aside className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
          <h2 className={panelTitleClass}>開始後</h2>
          <div className="grid gap-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            <p>OCR完了は待ちません。</p>
            <p>OCR中の作業として試合一覧へ戻ります。</p>
            <p>3枚未満でも開始できます。</p>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs leading-5 text-[var(--color-text-secondary)]">
            元画像の本体やIDはブラウザ保存せず、サーバー側の作業単位へ紐づけます。
          </div>
        </aside>
      </section>

      <section className={panelClass}>
        <div className="mb-4">
          <h2 className={panelTitleClass}>画像を入れる</h2>
          <p className={panelLeadClass}>撮影または単体画像の追加で、空いている分類へ配置します。</p>
        </div>
        <div className="grid gap-4">
          <div>
            <CameraCapture
              slotLabel="撮影台"
              onSelect={handleAddImage}
              onValidationError={handleValidationError}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
            <ImageInput
              slotLabel="撮影台"
              onSelect={handleAddImage}
              onValidationError={handleValidationError}
            />
            <p className="text-xs text-[var(--color-text-secondary)]">
              カメラが使えない場合は画像ファイルを追加してください。
            </p>
          </div>
        </div>
      </section>

      <section className="sticky bottom-3 z-[var(--z-sticky)] flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            {ocrReadyCount === 0 ? "分類トレイに画像を置いてください" : "OCRを開始できます"}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {selectedSlotLabels.length > 0
              ? `送信対象: ${selectedSlotLabels.join(" / ")}`
              : "画像は1枚から開始できます。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)]">
            {ocrReadyCount === 0 ? "画像未選択" : `送信対象 ${ocrReadyCount}件`}
          </span>
          <Button
            onClick={handleStartOcr}
            disabled={ocrReadyCount === 0 || hasWorkingSlot || uploadMutation.isPending}
          >
            OCRを開始して試合一覧へ
          </Button>
          <Button variant="secondary" onClick={handleReset}>
            撮影画像を全消去して次の試合へ
          </Button>
        </div>
      </section>

      <section className="grid gap-3">
        <div>
          <h2 className={panelTitleClass}>分類トレイ</h2>
          <p className={panelLeadClass}>
            各トレイ名がOCR種別になります。違っていたら、カード内の操作で入れ替えます。
          </p>
        </div>
        <CaptureRail
          slots={slots}
          drafts={drafts}
          onClear={handleClear}
          onDropImage={handleDropImage}
          onMoveImage={handleMoveImage}
          onManualRefresh={handleManualRefresh}
        />
      </section>

      {slots.map((slot) => (
        <SlotWatcher key={slot.kind} slot={slot} onUpdate={updateSlot} onDraft={setDraft} />
      ))}
    </div>
  );
}
