import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
import { CaptureRail } from "@/features/ocrCapture/CaptureRail";
import { slotDefinitions } from "@/features/ocrCapture/captureState";
import { ImageInput } from "@/features/ocrCapture/ImageInput";
import { OcrJobSlotWatcher } from "@/features/ocrCapture/OcrJobSlotWatcher";
import { SetupPanel } from "@/features/ocrCapture/SetupPanel";
import { useOcrCapturePageController } from "@/features/ocrCapture/useOcrCapturePageController";
import { AuthPanel } from "@/shared/auth/AuthPanel";
import { Button } from "@/shared/ui/actions/Button";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { MomoTransitBackdrop } from "@/shared/ui/feedback/MomoTransitBackdrop";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const panelClass =
  "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4";

const panelTitleClass = "text-lg font-semibold text-[var(--color-text-primary)]";

const panelLeadClass = "mt-1 text-sm leading-6 text-[var(--color-text-secondary)]";

export function OcrCapturePage() {
  const {
    auth,
    flow,
    handleDraftLoadError,
    handleStartOcr,
    handleValidationError,
    hasWorkingSlot,
    notice,
    notify,
    ocrReadyCount,
    partialStartAcknowledged,
    selectedSlotLabels,
    setSetup,
    setup,
    setupOptions,
    slotsFull,
    submission,
  } = useOcrCapturePageController();

  return (
    <PageFrame className="gap-5" width="workspace">
      <LiveRegion message={notice} />
      <PageHeader
        eyebrow="OCR"
        title="OCR取り込み"
        description="試合条件を選び、総資産・収益・事件簿の画像を読み取ります。処理状況は試合一覧で確認できます。"
      />

      {auth.error ? (
        <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/8 p-4 md:grid-cols-[1fr_18rem] md:items-center">
          <Notice className="border-0 bg-transparent p-0" tone="danger" title={auth.error.title}>
            <p>
              {auth.error.status === 403
                ? "この操作用アカウントでは利用できません。管理者に確認してください。"
                : auth.error.detail}
            </p>
          </Notice>
          <AuthPanel auth={auth.data} embedded forceDevPicker={auth.error.status === 401} />
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <div className="grid gap-4">
          <section className={panelClass}>
            <div className="mb-4">
              <h2 className={panelTitleClass}>1. 試合設定</h2>
              <p className={panelLeadClass}>確認画面で使う開催情報を先に選びます。</p>
            </div>
            <SetupPanel
              value={setup}
              onChange={setSetup}
              enabled={auth.ready}
              options={setupOptions}
            />
          </section>

          <section className={panelClass}>
            <div className="mb-4">
              <h2 className={panelTitleClass}>2. 画像を入れる</h2>
              <p className={panelLeadClass}>
                撮影またはファイル追加で、空いている分類へ配置します。違う分類なら右側で入れ替えます。
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
                    ? "3枚すべて配置済みのため、画像を追加できません。"
                    : "カメラが使えない場合は画像ファイルを追加してください。"}
                </p>
              </div>
            </div>
          </section>

          <section className="momo-safe-bottom relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4 shadow-sm sm:min-h-44 sm:pr-60">
            {ocrReadyCount === 0 ? (
              <MomoTransitBackdrop
                className="right-5 bottom-5 opacity-[0.18]"
                size="lg"
                tone="ready"
              />
            ) : null}
            <div className="relative z-[var(--z-base)] grid gap-4">
              <div className="max-w-2xl min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {ocrReadyCount === 0
                    ? "画像を入れると読み取りを開始できます"
                    : "読み取りを開始できます"}
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  {selectedSlotLabels.length > 0
                    ? `送信対象: ${selectedSlotLabels.join(" / ")}`
                    : "画像は1枚から開始できます。状況は試合一覧で確認できます。"}
                </p>
                {partialStartAcknowledged && ocrReadyCount < slotDefinitions.length ? (
                  <p className="mt-2 text-sm font-semibold text-[var(--color-review)]">
                    画像が{ocrReadyCount}
                    件だけ選択されています。このまま進める場合は、もう一度開始してください。
                  </p>
                ) : null}
                {hasWorkingSlot ? (
                  <p className="mt-2 text-sm font-semibold text-[var(--color-action)]">
                    読み取り中は分類と削除を固定します。状態は試合一覧で確認できます。
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
                  pending={submission.isSubmitting}
                  pendingLabel="読み取り開始中…"
                >
                  {partialStartAcknowledged && ocrReadyCount < slotDefinitions.length
                    ? "このまま読み取りを開始"
                    : "読み取りを開始して試合一覧へ"}
                </Button>
                <Button
                  disabled={submission.isSubmitting || hasWorkingSlot}
                  variant="secondary"
                  onClick={() => flow.handleResetAll(notify)}
                >
                  選択画像をすべて削除
                </Button>
              </div>
            </div>
          </section>
        </div>

        <aside className="grid gap-3 xl:sticky xl:top-20">
          <div>
            <h2 className={panelTitleClass}>3. 分類トレイ</h2>
            <p className={panelLeadClass}>
              分類名が読み取りの種類になります。違っていたらカード内の操作で入れ替えます。
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
        <OcrJobSlotWatcher
          key={slot.kind}
          slot={slot}
          onUpdate={flow.updateSlot}
          onDraft={flow.setDraft}
          onDraftLoadError={handleDraftLoadError}
        />
      ))}
    </PageFrame>
  );
}
