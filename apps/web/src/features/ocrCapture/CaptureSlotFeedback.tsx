import type { CaptureSlotView } from "@/features/ocrCapture/captureSlotView";
import type { SlotKind } from "@/shared/domain/ocr";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { contentText } from "@/shared/ui/typography";

const slotKindLabels = {
  incident_log: "事件簿",
  revenue: "収益",
  total_assets: "総資産",
} as const satisfies Record<SlotKind, string>;

type CaptureSlotFeedbackProps = {
  mismatch: boolean;
  refreshing: boolean;
  slot: CaptureSlotView;
  onRefreshStatus: () => void;
};

export function CaptureSlotFeedback({
  mismatch,
  refreshing,
  slot,
  onRefreshStatus,
}: CaptureSlotFeedbackProps) {
  const canRefreshStatus = slot.capabilities.canRefresh;

  return (
    <>
      {mismatch ? <CaptureMismatchAlert detectedKind={slot.detectedKind} /> : null}
      {slot.transportError ? <CaptureTransportError error={slot.transportError} /> : null}
      {slot.failureAction ? <CaptureJobFailure action={slot.failureAction} /> : null}
      {canRefreshStatus ? (
        <div
          className={cn(
            contentText.body,
            "grid gap-2 rounded-sm bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
          )}
        >
          <p>読み取り状態は自動更新されません。必要なときに最新の状態を取得してください。</p>
          <Button
            pending={refreshing}
            pendingLabel="更新中"
            variant="secondary"
            onClick={onRefreshStatus}
          >
            状態を更新
          </Button>
        </div>
      ) : null}
    </>
  );
}

function CaptureMismatchAlert({ detectedKind }: { detectedKind?: SlotKind | undefined }) {
  return (
    <Notice presentation="nested" role="alert" tone="warning">
      OCR判定は{" "}
      <strong className={contentText.compactPrimary}>
        {detectedKind ? slotKindLabels[detectedKind] : "別の分類"}
      </strong>{" "}
      でした。画像を正しい分類へ移動してから、もう一度読み取りを開始してください。
    </Notice>
  );
}

function CaptureTransportError({
  error,
}: {
  error: NonNullable<CaptureSlotView["transportError"]>;
}) {
  return (
    <Notice presentation="nested" title={error.title} tone="danger">
      <p>{error.detail}</p>
    </Notice>
  );
}

function CaptureJobFailure({ action }: { action: string }) {
  return (
    <Notice presentation="nested" title="画像を読み取れませんでした" tone="danger">
      <p>この分類の読み取り結果は作成されていません。</p>
      <p className="mt-1">{action}</p>
    </Notice>
  );
}
