import { ArrowLeft, Trash2 } from "lucide-react";

import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
import { CaptureRail } from "@/features/ocrCapture/CaptureRail";
import { slotDefinitions } from "@/features/ocrCapture/captureState";
import { ImageInput } from "@/features/ocrCapture/ImageInput";
import { OcrJobSlotWatcher } from "@/features/ocrCapture/OcrJobSlotWatcher";
import { OcrStartDialog } from "@/features/ocrCapture/OcrStartDialog";
import { SetupPanel } from "@/features/ocrCapture/SetupPanel";
import { useOcrCapturePageController } from "@/features/ocrCapture/useOcrCapturePageController";
import { AuthPanel } from "@/shared/auth/AuthPanel";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const panelClass = "min-w-0";

const panelTitleClass = "text-base font-semibold text-[var(--color-text-primary)]";
const panelLeadClass = "mt-1 text-sm leading-5 text-[var(--color-text-secondary)]";

export function OcrCapturePage() {
  const {
    auth,
    captureTargetKind,
    flow,
    handleCloseStartDialog,
    handleConfirmStart,
    handleDraftLoadError,
    handleImageSelected,
    handleSelectCaptureTarget,
    handleStartOcr,
    handleValidationError,
    handleViewMatches,
    hasWorkingSlot,
    memberAliasesFeedback,
    notify,
    ocrReadyCount,
    ocrStartDialog,
    returnTo,
    selectedSlotLabels,
    setSetup,
    setup,
    setupBlockedReason,
    setupOptions,
    setupReady,
    submission,
    submissionLocked,
  } = useOcrCapturePageController();

  const captureTarget = slotDefinitions.find((definition) => definition.kind === captureTargetKind);
  if (!captureTarget) return null;
  const selectedImageCount = flow.slots.filter((slot) => Boolean(slot.file)).length;
  const cameraDisabled = submissionLocked || hasWorkingSlot;
  const trayFull = selectedImageCount === slotDefinitions.length;

  return (
    <PageFrame className="gap-4">
      <PageHeader
        actions={
          returnTo ? (
            <LinkButton
              icon={<ArrowLeft aria-hidden="true" className="size-4" />}
              size="sm"
              to={returnTo}
              variant="quiet"
            >
              取り込みをやめる
            </LinkButton>
          ) : null
        }
        title="OCR取り込み"
      />

      <PageContentSurface className="grid gap-6">
        {auth.error ? (
          <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/8 p-4 md:grid-cols-[1fr_18rem] md:items-center">
            <Notice className="border-0 bg-transparent p-0" tone="danger" title={auth.error.title}>
              <p>
                {auth.error.status === 403
                  ? "この操作用アカウントでは利用できません。管理者に確認してください。"
                  : auth.error.detail}
              </p>
              {auth.error.status === 403 ? null : (
                <div className="mt-3">
                  <Button
                    pending={auth.retrying}
                    pendingLabel="確認中"
                    size="sm"
                    variant="secondary"
                    onClick={auth.retry}
                  >
                    ログイン状態を再確認
                  </Button>
                </div>
              )}
            </Notice>
            <AuthPanel auth={auth.data} embedded forceDevPicker={auth.error.status === 401} />
          </div>
        ) : null}

        {memberAliasesFeedback.error ? (
          <Notice tone="warning" title="プレーヤー名の読み替えを取得できません">
            <p>OCR取り込みは続けられますが、登録済みの別名を読み取り候補に反映できません。</p>
            <div className="mt-3">
              <Button
                pending={memberAliasesFeedback.retrying}
                pendingLabel="再読み込み中"
                size="sm"
                variant="secondary"
                onClick={memberAliasesFeedback.retry}
              >
                読み替え設定を再読み込み
              </Button>
            </div>
          </Notice>
        ) : null}

        <section className={panelClass} aria-labelledby="ocr-record-destination">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="ocr-record-destination" className={panelTitleClass}>
              記録先
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">読み取り結果に引き継ぐ試合設定</p>
          </div>
          {setupOptions.hasError ? (
            <Notice className="mb-3" tone="warning" title="試合設定の選択肢を読み込めません">
              <p>読み込めなかった選択肢を再取得できます。</p>
              <div className="mt-3">
                <Button
                  pending={setupOptions.refreshing}
                  pendingLabel="再読み込み中"
                  size="sm"
                  variant="secondary"
                  onClick={setupOptions.retry}
                >
                  選択肢を再読み込み
                </Button>
              </div>
            </Notice>
          ) : null}
          <SetupPanel
            value={setup}
            onChange={setSetup}
            enabled={auth.ready}
            options={setupOptions}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem] xl:items-start">
          <section className={panelClass} aria-labelledby="ocr-camera-title">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="ocr-camera-title" className={panelTitleClass}>
                  画面を撮影
                </h2>
                <p className={panelLeadClass}>ゲーム画面全体が入るようにカメラを合わせます。</p>
              </div>
              <div
                className="flex items-center gap-2 py-1 text-sm"
                aria-label={`次の撮影先は${captureTarget.label}`}
              >
                <span
                  aria-hidden="true"
                  className={`h-5 w-1 rounded-full ${captureTarget.accentClass}`}
                />
                <span className="text-xs text-[var(--color-text-secondary)]">撮影先</span>
                <strong className="text-[var(--color-text-primary)]">{captureTarget.label}</strong>
              </div>
            </div>

            <CameraCapture
              actionVariant={trayFull ? "secondary" : "primary"}
              disabled={cameraDisabled}
              slotLabel={captureTarget.label}
              onSelect={handleImageSelected}
              onValidationError={handleValidationError}
              renderFallback={(prominent) => (
                <ImageInput
                  disabled={cameraDisabled}
                  prominent={prominent}
                  slotLabel={captureTarget.label}
                  onSelect={handleImageSelected}
                  onValidationError={handleValidationError}
                />
              )}
            />
          </section>

          <aside className="grid gap-3 xl:sticky xl:top-20" aria-labelledby="ocr-tray-title">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 id="ocr-tray-title" className={panelTitleClass}>
                  分類トレイ
                </h2>
                <p className={panelLeadClass}>撮影先を選び、必要なら画像を入れ替えます。</p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-[var(--color-text-secondary)]">
                {selectedImageCount} / {slotDefinitions.length} 配置
              </span>
            </div>
            <CaptureRail
              captureTargetKind={captureTargetKind}
              layout="stack"
              slots={flow.slots}
              drafts={flow.drafts}
              onClear={(kind) => flow.handleClear(kind, notify)}
              onDropImage={(source, target) => flow.handleDropImage(source, target, notify)}
              onMoveImage={(kind, direction) => flow.handleMoveImage(kind, direction, notify)}
              onManualRefresh={flow.handleManualRefresh}
              onSelectCaptureTarget={handleSelectCaptureTarget}
            />
          </aside>
        </section>

        <section
          className="momo-safe-bottom grid gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4"
          aria-labelledby="ocr-start-title"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="ocr-start-title" className={panelTitleClass}>
                読み取りの準備
              </h2>
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1 text-xs font-semibold text-[var(--color-text-primary)]">
                {ocrReadyCount === 0 ? "画像未選択" : `${ocrReadyCount}件を送信`}
              </span>
            </div>
            <p className={panelLeadClass}>
              {selectedSlotLabels.length > 0
                ? `${selectedSlotLabels.join("・")}を読み取ります。${
                    ocrReadyCount < slotDefinitions.length
                      ? "未配置の分類は確認画面で手入力できます。"
                      : "3種類すべて揃っています。"
                  }`
                : "分類トレイを選び、まず1枚撮影してください。"}
            </p>
            {setupBlockedReason ? (
              <p className="mt-2 text-sm font-semibold text-[var(--color-review)]">
                {setupBlockedReason}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <Button
              className="w-full sm:w-auto"
              disabled={
                ocrReadyCount === 0 || hasWorkingSlot || submission.isSubmitting || !setupReady
              }
              size="lg"
              variant="primary"
              onClick={handleStartOcr}
            >
              {ocrReadyCount === 0 ? "読み取りを開始" : `${ocrReadyCount}件で読み取りを開始`}
            </Button>
            <AlertDialog
              confirmLabel={`${selectedImageCount}件を削除`}
              description="分類トレイに配置した画像をすべて外します。試合設定は残ります。"
              title="選択画像をすべて削除しますか？"
              trigger={
                <Button
                  disabled={selectedImageCount === 0 || cameraDisabled}
                  icon={<Trash2 aria-hidden="true" className="size-4" />}
                  size="sm"
                  variant="quiet"
                >
                  すべて削除
                </Button>
              }
              onConfirm={() => flow.handleResetAll(notify)}
            />
          </div>
        </section>
      </PageContentSurface>

      <OcrStartDialog
        state={ocrStartDialog}
        onClose={handleCloseStartDialog}
        onConfirm={handleConfirmStart}
        onViewMatches={handleViewMatches}
      />

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
