import { useEffect, useState } from "react";

import { getOcrDraft } from "@/features/ocrCapture/api";
import type { OcrDraftResponse } from "@/features/ocrCapture/api";
import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
import { CaptureRail } from "@/features/ocrCapture/CaptureRail";
import { detectedKindFromResponse, slotDefinitions } from "@/features/ocrCapture/captureState";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { ImageInput } from "@/features/ocrCapture/ImageInput";
import { defaultSetupValues } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { SetupPanel } from "@/features/ocrCapture/SetupPanel";
import { isWorkingStatus } from "@/features/ocrCapture/slotPolicy";
import { useOcrCaptureDraftFlow } from "@/features/ocrCapture/useOcrCaptureDraftFlow";
import { useOcrCaptureMutations } from "@/features/ocrCapture/useOcrCaptureMutations";
import { useOcrCaptureQueries } from "@/features/ocrCapture/useOcrCaptureQueries";
import { useOcrJobPolling } from "@/features/ocrCapture/useOcrJobPolling";
import type { SlotKind } from "@/shared/api/enums";
import { parseOcrJobStatus } from "@/shared/api/enums";
import { AuthPanel } from "@/shared/auth/AuthPanel";
import { useDistinctMarkerEffect } from "@/shared/lib/useDistinctMarkerEffect";
import { Button } from "@/shared/ui/actions/Button";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Notice } from "@/shared/ui/feedback/Notice";
import { showToast } from "@/shared/ui/feedback/Toast";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type SlotWatcherProps = {
  slot: CaptureSlotState;
  onUpdate: (slot: CaptureSlotState) => void;
  onDraft: (kind: SlotKind, draft: OcrDraftResponse) => void;
};

function SlotWatcher({ slot, onUpdate, onDraft }: SlotWatcherProps) {
  const query = useOcrJobPolling({ jobId: slot.jobId, attempts: slot.pollAttempts });

  const marker =
    query.data && slot.jobId
      ? `${slot.jobId}:${query.data.status}:${query.data.updatedAt}:${query.data.draftId ?? ""}`
      : null;

  useDistinctMarkerEffect(marker, () => {
    if (!query.data) {
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
  });

  return null;
}

const panelClass =
  "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4";

const panelTitleClass = "text-lg font-semibold text-[var(--color-text-primary)]";

const panelLeadClass = "mt-1 text-sm leading-6 text-[var(--color-text-secondary)]";

export function OcrCapturePage() {
  const [setup, setSetup] = useState<SetupFormValues>(defaultSetupValues);
  const [notice, setNotice] = useState("");
  const [partialStartAcknowledged, setPartialStartAcknowledged] = useState(false);

  const { auth, gameTitlesQuery, hints } = useOcrCaptureQueries(setup.gameTitleId);
  const flow = useOcrCaptureDraftFlow();
  const submission = useOcrCaptureMutations(hints);

  function notify(message: string, tone: "info" | "success" | "warning" = "info") {
    setNotice(message);
    showToast({ title: message, tone });
  }

  function handleValidationError(message: string) {
    notify(message);
  }

  async function handleStartOcr() {
    if (ocrReadyCount < slotDefinitions.length && !partialStartAcknowledged) {
      setPartialStartAcknowledged(true);
      notify(
        "3種類すべての画像は揃っていません。続行する場合はもう一度OCR開始を押してください。",
        "warning",
      );
      return;
    }
    const selectedGameTitle = gameTitlesQuery.data?.items?.find(
      (item) => item.id === setup.gameTitleId,
    );
    await submission.submit({
      notify,
      selectedGameTitle,
      setup,
      slots: flow.slots,
      updateSlot: flow.updateSlot,
    });
  }

  const ocrReadyCount = flow.slots.filter(
    (slot) => slot.file && ["selected", "failed", "cancelled"].includes(slot.status),
  ).length;
  const hasWorkingSlot = flow.slots.some((slot) => isWorkingStatus(slot.status));
  const slotsFull = flow.slots.every((slot) => Boolean(slot.file));
  const selectedSlotLabels = slotDefinitions
    .filter((definition) =>
      flow.slots.some(
        (slot) =>
          slot.kind === definition.kind &&
          slot.file &&
          ["selected", "failed", "cancelled"].includes(slot.status),
      ),
    )
    .map((definition) => definition.label);

  useEffect(() => {
    setPartialStartAcknowledged(false);
  }, [ocrReadyCount]);

  return (
    <PageFrame className="gap-5" width="workspace">
      <LiveRegion message={notice} />
      <PageHeader
        eyebrow="OCR"
        title="OCR取り込み"
        description="試合条件を選び、総資産・収益・事件簿の画像を分類してOCRを開始します。結果待ちは試合一覧で扱います。"
      />

      {auth.error ? (
        <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/8 p-4 md:grid-cols-[1fr_18rem] md:items-center">
          <Notice className="border-0 bg-transparent p-0" tone="danger" title={auth.error.title}>
            <p>
              {auth.error.status === 403
                ? "許可されていない開発用アカウントです。API の DEV_MEMBER_IDS を確認してください。"
                : auth.error.detail}
            </p>
          </Notice>
          <AuthPanel auth={auth.data} forceDevPicker={auth.error.status === 401} />
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <div className="grid gap-4">
          <section className={panelClass}>
            <div className="mb-4">
              <h2 className={panelTitleClass}>1. 試合設定</h2>
              <p className={panelLeadClass}>
                OCRの読み取り方式と、後続の確認画面で使う開催情報を先に選びます。
              </p>
            </div>
            <SetupPanel
              value={setup}
              onChange={setSetup}
              enabled={auth.ready}
              authMemberId={auth.memberId}
            />
          </section>

          <section className={panelClass}>
            <div className="mb-4">
              <h2 className={panelTitleClass}>2. 画像を入れる</h2>
              <p className={panelLeadClass}>
                撮影または画像追加で、空いている分類トレイへ自動配置します。分類が違う場合は右のトレイで入れ替えます。
              </p>
            </div>
            <div className="grid gap-4">
              <CameraCapture
                disabled={slotsFull}
                slotLabel="OCR"
                onSelect={(file, source) => flow.handleAddImage(file, source, notify)}
                onValidationError={handleValidationError}
              />
              <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
                <ImageInput
                  disabled={slotsFull}
                  slotLabel="OCR"
                  onSelect={(file, source) => flow.handleAddImage(file, source, notify)}
                  onValidationError={handleValidationError}
                />
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {slotsFull
                    ? "分類トレイが埋まっているため、追加アップロードはできません。"
                    : "カメラが使えない場合は画像ファイルを追加してください。"}
                </p>
              </div>
            </div>
          </section>

          <section className="momo-safe-bottom flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4 shadow-sm">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                {ocrReadyCount === 0 ? "分類トレイに画像を置いてください" : "OCRを開始できます"}
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {selectedSlotLabels.length > 0
                  ? `送信対象: ${selectedSlotLabels.join(" / ")}`
                  : "画像は1枚から開始できます。OCR完了は待たず、試合一覧で状態を確認します。"}
              </p>
              {partialStartAcknowledged && ocrReadyCount < slotDefinitions.length ? (
                <p className="mt-2 text-sm font-semibold text-[var(--color-review)]">
                  画像が{ocrReadyCount}
                  件だけ選択されています。不足したまま進める場合は、もう一度開始してください。
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)]">
                {ocrReadyCount === 0 ? "画像未選択" : `送信対象 ${ocrReadyCount}件`}
              </span>
              <Button
                onClick={handleStartOcr}
                disabled={ocrReadyCount === 0 || hasWorkingSlot || submission.isSubmitting}
              >
                {partialStartAcknowledged && ocrReadyCount < slotDefinitions.length
                  ? "不足したままOCR開始"
                  : "OCRを開始して試合一覧へ"}
              </Button>
              <Button variant="secondary" onClick={() => flow.handleResetAll(notify)}>
                画像を全消去
              </Button>
            </div>
          </section>
        </div>

        <aside className="grid gap-3 xl:sticky xl:top-20">
          <div>
            <h2 className={panelTitleClass}>3. 分類トレイ</h2>
            <p className={panelLeadClass}>
              トレイ名がOCR種別になります。違っていたらカード内の操作で入れ替えます。
            </p>
          </div>
          <CaptureRail
            layout="stack"
            slots={flow.slots}
            drafts={flow.drafts}
            onClear={(kind) => flow.handleClear(kind, notify)}
            onDropImage={(source, target) => flow.handleDropImage(source, target, notify)}
            onMoveImage={(kind, direction) => flow.handleMoveImage(kind, direction, notify)}
            onManualRefresh={flow.handleManualRefresh}
          />
        </aside>
      </section>

      {flow.slots.map((slot) => (
        <SlotWatcher
          key={slot.kind}
          slot={slot}
          onUpdate={flow.updateSlot}
          onDraft={flow.setDraft}
        />
      ))}
    </PageFrame>
  );
}
