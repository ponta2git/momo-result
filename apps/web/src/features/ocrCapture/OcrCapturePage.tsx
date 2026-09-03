import { ArrowLeft, Trash2 } from "lucide-react";

import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
import { CaptureRail } from "@/features/ocrCapture/CaptureRail";
import { ImageInput } from "@/features/ocrCapture/ImageInput";
import { OcrStartDialog } from "@/features/ocrCapture/OcrStartDialog";
import { SetupPanel } from "@/features/ocrCapture/SetupPanel";
import { useOcrCapturePageModel } from "@/features/ocrCapture/useOcrCapturePageModel";
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
  const { capture, feedback, navigation, setup, submission } = useOcrCapturePageModel();

  return (
    <PageFrame className="gap-4">
      <PageHeader
        actions={
          navigation.returnTo ? (
            <LinkButton
              icon={<ArrowLeft aria-hidden="true" />}
              size="sm"
              to={navigation.returnTo}
              variant="quiet"
            >
              取り込みをやめる
            </LinkButton>
          ) : null
        }
        title="OCR取り込み"
      />

      <PageContentSurface className="grid gap-6">
        {feedback.auth.error ? (
          <div className="grid gap-3 rounded-md border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/8 p-4 md:grid-cols-[1fr_18rem] md:items-center">
            <Notice presentation="bare" tone="danger" title={feedback.auth.error.title}>
              <p>
                {feedback.auth.error.status === 403
                  ? "この操作用アカウントでは利用できません。管理者に確認してください。"
                  : feedback.auth.error.detail}
              </p>
              {feedback.auth.error.status === 403 ? null : (
                <div className="mt-3">
                  <Button
                    pending={feedback.auth.retrying}
                    pendingLabel="確認中"
                    size="sm"
                    variant="secondary"
                    onClick={feedback.auth.retry}
                  >
                    ログイン状態を再確認
                  </Button>
                </div>
              )}
            </Notice>
            <AuthPanel
              auth={feedback.auth.data}
              embedded
              forceDevPicker={feedback.auth.error.status === 401}
            />
          </div>
        ) : null}

        {feedback.memberAliases.error ? (
          <Notice tone="warning" title="プレーヤー名の読み替えを取得できません">
            <p>OCR取り込みは続けられますが、登録済みの別名を読み取り候補に反映できません。</p>
            <div className="mt-3">
              <Button
                pending={feedback.memberAliases.refreshing}
                pendingLabel="再読み込み中"
                size="sm"
                variant="secondary"
                onClick={feedback.memberAliases.refresh}
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
          {setup.choices.failed ? (
            <div className="mb-3">
              <Notice tone="warning" title="試合設定の選択肢を読み込めません">
                <p>読み込めなかった選択肢を再取得できます。</p>
                <div className="mt-3">
                  <Button
                    pending={setup.choices.refreshing}
                    pendingLabel="再読み込み中"
                    size="sm"
                    variant="secondary"
                    onClick={setup.choices.refresh}
                  >
                    選択肢を再読み込み
                  </Button>
                </div>
              </Notice>
            </div>
          ) : null}
          <SetupPanel model={setup.panel} />
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
                aria-label={`次の撮影先は${capture.camera.target.label}`}
              >
                <span
                  aria-hidden="true"
                  className={`h-5 w-1 rounded-full ${capture.camera.target.accentClass}`}
                />
                <span className="text-xs text-[var(--color-text-secondary)]">撮影先</span>
                <strong className="text-[var(--color-text-primary)]">
                  {capture.camera.target.label}
                </strong>
              </div>
            </div>

            <div className="max-w-[56rem]">
              <CameraCapture
                actionVariant={capture.camera.actionVariant}
                disabled={capture.camera.disabled}
                slotLabel={capture.camera.target.label}
                onSelect={capture.camera.selectImage}
                onValidationError={capture.camera.reportValidationError}
                renderFallback={(prominent) => (
                  <ImageInput
                    disabled={capture.camera.disabled}
                    prominent={prominent}
                    slotLabel={capture.camera.target.label}
                    onSelect={capture.camera.selectImage}
                    onValidationError={capture.camera.reportValidationError}
                  />
                )}
              />
            </div>
          </section>

          <aside className="grid gap-3 xl:sticky xl:top-20" aria-labelledby="ocr-tray-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="ocr-tray-title" className={panelTitleClass}>
                  分類トレイ
                </h2>
                <p className={panelLeadClass}>撮影先を選び、必要なら画像を入れ替えます。</p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-[var(--color-text-secondary)]">
                配置済み{capture.selectedImageCount}件／全{capture.totalSlotCount}件
              </span>
            </div>
            <CaptureRail
              captureTargetKind={capture.tray.captureTargetKind}
              layout="stack"
              slots={capture.tray.slots}
              drafts={capture.tray.drafts}
              statusRefreshing={capture.tray.statusRefreshing}
              onClear={capture.tray.clear}
              onDropImage={capture.tray.drop}
              onMoveImage={capture.tray.move}
              onRefreshStatus={capture.tray.refreshStatus}
              onSelectCaptureTarget={capture.tray.selectTarget}
            />
            <p
              aria-label="分類トレイの操作結果"
              aria-atomic="true"
              aria-live="polite"
              className="min-h-5 text-xs leading-5 text-[var(--color-text-secondary)]"
              role="status"
            >
              {capture.tray.actionFeedback}
            </p>
          </aside>
        </section>

        <section
          className="momo-safe-bottom grid gap-3 rounded-md bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4"
          aria-labelledby="ocr-start-title"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="ocr-start-title" className={panelTitleClass}>
                読み取りの準備
              </h2>
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1 text-xs font-semibold text-[var(--color-text-primary)]">
                {submission.start.badgeLabel}
              </span>
            </div>
            <p className={panelLeadClass}>{submission.start.description}</p>
            {submission.start.blockedReason ? (
              <p className="mt-2 text-sm font-semibold text-[var(--color-review)]">
                {submission.start.blockedReason}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="grid w-full sm:w-auto">
              <Button
                disabled={submission.start.disabled}
                size="lg"
                variant="primary"
                onClick={submission.start.run}
              >
                {submission.start.buttonLabel}
              </Button>
            </div>
            <AlertDialog
              confirmLabel={`${capture.selectedImageCount}件を破棄`}
              description="分類トレイから画像を外します。再度使うには、撮影またはファイル選択が必要です。試合設定は残ります。"
              title="配置した画像をすべて破棄しますか？"
              trigger={
                <Button
                  disabled={capture.tray.resetDisabled}
                  icon={<Trash2 aria-hidden="true" />}
                  size="sm"
                  variant="quiet"
                >
                  画像の選択をすべて破棄
                </Button>
              }
              onConfirm={capture.tray.reset}
            />
          </div>
        </section>
      </PageContentSurface>

      <OcrStartDialog
        state={submission.dialog.state}
        onClose={submission.dialog.close}
        onConfirm={submission.dialog.confirm}
        onViewMatches={submission.dialog.viewMatches}
      />
    </PageFrame>
  );
}
