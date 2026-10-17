import { ArrowLeft, Trash2 } from "lucide-react";
import { memo } from "react";

import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
import { CaptureRail } from "@/features/ocrCapture/CaptureRail";
import { ImageInput } from "@/features/ocrCapture/ImageInput";
import type {
  OcrCaptureCameraModel,
  OcrCaptureTrayModel,
  OcrCaptureStartModel,
} from "@/features/ocrCapture/ocrCaptureModel";
import {
  OcrCaptureSetupProvider,
  OcrCaptureSetupSection,
} from "@/features/ocrCapture/OcrCaptureSetup";
import { OcrStartDialog } from "@/features/ocrCapture/OcrStartDialog";
import {
  useOcrCaptureAuth,
  useOcrCapturePageModel,
} from "@/features/ocrCapture/useOcrCapturePageModel";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { inlineActionGroupClass, taskActionPanelClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { contentText } from "@/shared/ui/typography";

const panelClass = "grid min-w-0 gap-4";
const panelTitleClass = contentText.heading;
const panelLeadClass = cn(contentText.body, "mt-1");

export function OcrCapturePage() {
  const auth = useOcrCaptureAuth();
  return (
    <OcrCaptureSetupProvider authReady={auth.ready} key={auth.accountId ?? "unresolved"}>
      <PageFrame>
        <nav aria-label="OCR取り込みの移動" className={inlineActionGroupClass}>
          <LinkButton
            icon={<ArrowLeft aria-hidden="true" />}
            size="sm"
            to="/matches"
            variant="quiet"
          >
            取り込みをやめる
          </LinkButton>
        </nav>
        <PageContentSurface aria-label="OCR取り込み" className="grid gap-6" role="region">
          <OcrCaptureSetupSection />
          <OcrCaptureWorkspace />
        </PageContentSurface>
      </PageFrame>
    </OcrCaptureSetupProvider>
  );
}

function OcrCaptureWorkspace() {
  const { camera, tray, start, navigation, dialog } = useOcrCapturePageModel();
  return (
    <>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem] xl:items-start">
        <OcrCaptureCamera model={camera} />
        <OcrCaptureTray model={tray} />
      </section>
      <OcrCaptureStart model={start} />
      <OcrStartDialog
        navigationPending={dialog.navigationPending}
        view={dialog.view}
        onClose={dialog.close}
        onConfirm={dialog.confirm}
        onViewMatches={dialog.viewMatches}
      />
      <UnsavedChangesGuard
        preservesInput={(current, next) => current.pathname === next.pathname}
        description="配置した画像はまだ読み取りを開始していません。移動すると画像の選択は失われ、撮影またはファイル選択が必要になります。"
        model={navigation.guard}
        pending={navigation.pending}
        showPendingDialog={false}
      />
    </>
  );
}

const OcrCaptureCamera = memo(function OcrCaptureCamera({
  model,
}: {
  model: OcrCaptureCameraModel;
}) {
  return (
    <section className={panelClass} aria-labelledby="ocr-camera-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ocr-camera-title" className={panelTitleClass}>
            画面を撮影
          </h2>
          <p className={panelLeadClass}>ゲーム画面全体が入るようにカメラを合わせます。</p>
        </div>
      </div>

      <div className="max-w-[56rem]">
        <CameraCapture
          actionVariant={model.actionVariant}
          disabled={model.disabled}
          slotLabel={model.slotLabel}
          onSelect={model.selectImage}
          onValidationError={model.reportValidationError}
          renderFallback={(prominent) => (
            <ImageInput
              disabled={model.disabled}
              prominent={prominent}
              slotLabel={model.slotLabel}
              onSelect={model.selectImage}
              onValidationError={model.reportValidationError}
            />
          )}
        />
      </div>
    </section>
  );
});

const OcrCaptureTray = memo(function OcrCaptureTray({ model }: { model: OcrCaptureTrayModel }) {
  return (
    <aside className="grid gap-4 xl:sticky xl:top-20" aria-labelledby="ocr-tray-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="ocr-tray-title" className={panelTitleClass}>
            分類トレイ
          </h2>
          <p className={panelLeadClass}>撮影先を選び、必要なら画像を入れ替えます。</p>
        </div>
        <span className={cn(contentText.supporting, "shrink-0")}>
          配置済み{model.selectedImageCount}件／全{model.totalSlotCount}件
        </span>
      </div>
      <div className="grid gap-1">
        <CaptureRail
          captureTargetKind={model.captureTargetKind}
          layout="stack"
          slots={model.slots}
          onClear={model.clear}
          onDropImage={model.drop}
          onMoveImage={model.move}
          onRefreshStatus={model.refreshStatus}
          onSelectCaptureTarget={model.selectTarget}
        />
        <p
          aria-label="分類トレイの操作結果"
          aria-atomic="true"
          aria-live="polite"
          className={cn(contentText.body, "min-h-5")}
          role="status"
        >
          {model.actionFeedback}
        </p>
      </div>
    </aside>
  );
});

const OcrCaptureStart = memo(function OcrCaptureStart({ model }: { model: OcrCaptureStartModel }) {
  return (
    <section
      className={cn(
        taskActionPanelClass,
        "momo-safe-bottom sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
      )}
      aria-labelledby="ocr-start-title"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="ocr-start-title" className={panelTitleClass}>
            読み取りの準備
          </h2>
          <span className="font-plain rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1 text-xs text-[var(--color-text-primary)]">
            {model.badgeLabel}
          </span>
        </div>
        <p className={panelLeadClass}>{model.description}</p>
        {model.error ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {model.error}
          </p>
        ) : null}
        {model.blockedReason ? (
          <p className="font-emphasis mt-2 text-sm text-[var(--color-review)]">
            {model.blockedReason}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:items-end">
        <div className="grid w-full sm:w-auto">
          <Button disabled={model.disabled} size="lg" variant="primary" onClick={model.run}>
            {model.buttonLabel}
          </Button>
        </div>
        <AlertDialog
          confirmLabel={`${model.selectedImageCount}件を破棄`}
          description="分類トレイから画像を外します。再度使うには、撮影またはファイル選択が必要です。試合設定は残ります。"
          title="配置した画像をすべて破棄しますか？"
          trigger={
            <Button
              disabled={model.resetDisabled}
              icon={<Trash2 aria-hidden="true" />}
              size="sm"
              variant="quiet"
            >
              画像の選択をすべて破棄
            </Button>
          }
          onConfirm={model.reset}
        />
      </div>
    </section>
  );
});
