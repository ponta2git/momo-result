import { useState } from "react";
import { Link } from "react-router-dom";

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

const linkButtonClass =
  "inline-flex min-h-10 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)]";

export function OcrCapturePage() {
  const [setup, setSetup] = useState<SetupFormValues>(defaultSetupValues);
  const [notice, setNotice] = useState("");

  const { auth, gameTitlesQuery, hints } = useOcrCaptureQueries(setup.gameTitleId);
  const flow = useOcrCaptureDraftFlow();
  const submission = useOcrCaptureMutations(hints);

  function notify(message: string) {
    setNotice(message);
    showToast({ title: message, tone: "info" });
  }

  function handleValidationError(message: string) {
    notify(message);
  }

  async function handleStartOcr() {
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

  return (
    <div className="grid gap-5">
      <LiveRegion message={notice || submission.status} />
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

      {auth.error ? (
        <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/8 p-4 md:grid-cols-[1fr_18rem] md:items-center">
          <Notice className="border-0 bg-transparent p-0" tone="danger" title={auth.error.title}>
            <p>
              {auth.error.status === 403
                ? "DEV_MEMBER_IDS に含まれていないユーザーです。"
                : auth.error.detail}
            </p>
          </Notice>
          <AuthPanel auth={auth.data} forceDevPicker={auth.error.status === 401} />
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
            enabled={auth.ready}
            authMemberId={auth.memberId}
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
              onSelect={(file, source) => flow.handleAddImage(file, source, notify)}
              onValidationError={handleValidationError}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
            <ImageInput
              slotLabel="撮影台"
              onSelect={(file, source) => flow.handleAddImage(file, source, notify)}
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
            disabled={ocrReadyCount === 0 || hasWorkingSlot || submission.isSubmitting}
          >
            OCRを開始して試合一覧へ
          </Button>
          <Button variant="secondary" onClick={() => flow.handleResetAll(notify)}>
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
          slots={flow.slots}
          drafts={flow.drafts}
          onClear={(kind) => flow.handleClear(kind, notify)}
          onDropImage={(source, target) => flow.handleDropImage(source, target, notify)}
          onMoveImage={(kind, direction) => flow.handleMoveImage(kind, direction, notify)}
          onManualRefresh={flow.handleManualRefresh}
        />
      </section>

      {flow.slots.map((slot) => (
        <SlotWatcher
          key={slot.kind}
          slot={slot}
          onUpdate={flow.updateSlot}
          onDraft={flow.setDraft}
        />
      ))}
    </div>
  );
}
