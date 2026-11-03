import { ArrowLeft, Trash2 } from "lucide-react";
import { memo } from "react";
import { useSearchParams } from "react-router-dom";

import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
import { CaptureRail } from "@/features/ocrCapture/CaptureRail";
import { ImageInput } from "@/features/ocrCapture/ImageInput";
import type {
  OcrCaptureCameraView,
  OcrCaptureTrayView,
  OcrCaptureStartView,
} from "@/features/ocrCapture/ocrCapturePresentation";
import { OcrSectionHeading } from "@/features/ocrCapture/OcrSectionHeading";
import { OcrStartDialog } from "@/features/ocrCapture/OcrStartDialog";
import {
  OcrCaptureSetupProvider,
  OcrCaptureSetupSection,
} from "@/features/ocrCapture/setup/OcrCaptureSetup";
import { useOcrCaptureAuth, useOcrCapture } from "@/features/ocrCapture/useOcrCapture";
import { trimSearchParam } from "@/shared/lib/searchParams";
import { heldEventDetailHref } from "@/shared/navigation/publicIdentifiers";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { inlineActionGroupClass, taskActionPanelClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { compactBadgeClass, compactBadgeToneClass } from "@/shared/ui/status/badgeRecipes";
import { contentText, fieldText } from "@/shared/ui/typography";

export function OcrCapturePage() {
  const auth = useOcrCaptureAuth();
  const [searchParams] = useSearchParams();
  // A capture started from a held event's hub returns there; without one, to the matches.
  const startedFrom = trimSearchParam(searchParams.get("heldEventId"));
  const exitHref = startedFrom ? heldEventDetailHref(startedFrom) : "/matches";
  return (
    <OcrCaptureSetupProvider authReady={auth.ready} key={auth.accountId ?? "unresolved"}>
      <PageFrame>
        <PageContentSurface aria-label="OCR取り込み" className="grid gap-6" role="region">
          <nav aria-label="OCR取り込みの移動" className={inlineActionGroupClass}>
            <LinkButton
              icon={<ArrowLeft aria-hidden="true" />}
              size="sm"
              to={exitHref}
              variant="quiet"
            >
              取り込みをやめる
            </LinkButton>
          </nav>
          <OcrCaptureSetupSection />
          <OcrCaptureWorkspace />
        </PageContentSurface>
      </PageFrame>
    </OcrCaptureSetupProvider>
  );
}

function OcrCaptureWorkspace() {
  const { camera, tray, start, navigation, dialog } = useOcrCapture();
  return (
    <>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <OcrCaptureCamera view={camera} />
        <OcrCaptureTray view={tray} />
      </section>
      <OcrCaptureStart view={start} />
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

const OcrCaptureCamera = memo(function OcrCaptureCamera({ view }: { view: OcrCaptureCameraView }) {
  return (
    <section className="grid min-w-0 gap-4" aria-labelledby="ocr-camera-title">
      <OcrSectionHeading
        id="ocr-camera-title"
        lead="ゲーム画面全体が入るようにカメラを合わせます。"
        title="画面を撮影"
      />

      {/* Beside the tray the camera uses its whole column; stacked, it stays within one view. */}
      <div className="max-w-4xl xl:max-w-none">
        <CameraCapture
          actionVariant={view.actionVariant}
          disabled={view.disabled}
          slotLabel={view.slotLabel}
          onSelect={view.selectImage}
          onValidationError={view.reportValidationError}
          renderFallback={(prominent) => (
            <ImageInput
              disabled={view.disabled}
              prominent={prominent}
              slotLabel={view.slotLabel}
              onSelect={view.selectImage}
              onValidationError={view.reportValidationError}
            />
          )}
        />
      </div>
    </section>
  );
});

const OcrCaptureTray = memo(function OcrCaptureTray({ view }: { view: OcrCaptureTrayView }) {
  return (
    <aside
      className="grid gap-4 xl:sticky xl:top-(--sticky-below-nav) xl:w-md"
      aria-labelledby="ocr-tray-title"
    >
      <OcrSectionHeading
        id="ocr-tray-title"
        lead="撮影先を選び、必要なら画像を入れ替えます。"
        status={
          <p className={cn(contentText.supporting, "tabular-nums")}>
            配置済み{view.selectedImageCount}件／全{view.totalSlotCount}件
          </p>
        }
        title="分類トレイ"
      />
      <CaptureRail
        captureTargetKind={view.captureTargetKind}
        layout="stack"
        slots={view.slots}
        onClear={view.clearImage}
        onDropImage={view.swapImages}
        onMoveImage={view.swapWithAdjacentSlot}
        onRefreshStatus={view.refreshStatus}
        onSelectCaptureTarget={view.selectTarget}
      />
      {/* The result covers the whole tray, so it keeps the tray's spacing rather than a card's. */}
      <p
        aria-label="分類トレイの操作結果"
        aria-atomic="true"
        aria-live="polite"
        className={cn(contentText.body, "min-h-5")}
        role="status"
      >
        {view.actionFeedback}
      </p>
    </aside>
  );
});

const OcrCaptureStart = memo(function OcrCaptureStart({ view }: { view: OcrCaptureStartView }) {
  return (
    // Variable-height feedback and the actions share a top edge, so an error never moves them.
    <section
      className={cn(taskActionPanelClass, "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start")}
      aria-labelledby="ocr-start-title"
    >
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="ocr-start-title" className={contentText.heading}>
            読み取りの準備
          </h2>
          <span className={cn(compactBadgeClass, compactBadgeToneClass.neutral)}>
            {view.badgeLabel}
          </span>
        </div>
        <p className={contentText.body}>{view.description}</p>
        {view.error ? (
          <p className={fieldText.error} role="alert">
            {view.error}
          </p>
        ) : null}
        {view.blockedReason ? (
          <p className="font-emphasis text-sm/5 text-[var(--color-review)]">{view.blockedReason}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:items-end">
        <div className="grid w-full sm:w-auto">
          <Button
            disabled={view.disabled}
            size="lg"
            variant="primary"
            onClick={view.reviewSubmission}
          >
            {view.buttonLabel}
          </Button>
        </div>
        <AlertDialog
          confirmLabel={`${view.selectedImageCount}件を破棄`}
          description="分類トレイから画像を外します。再度使うには、撮影またはファイル選択が必要です。試合設定は残ります。"
          title="配置した画像をすべて破棄しますか？"
          trigger={
            <Button
              disabled={view.clearAllDisabled}
              icon={<Trash2 aria-hidden="true" />}
              size="sm"
              variant="quiet"
            >
              画像の選択をすべて破棄
            </Button>
          }
          onConfirm={view.clearAllImages}
        />
      </div>
    </section>
  );
});
