import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import type { SlotKind } from "@/shared/api/enums";
import { Button } from "@/shared/ui/actions/Button";

const slotKindLabels = {
  incident_log: "事件簿",
  revenue: "収益",
  total_assets: "総資産",
} as const satisfies Record<SlotKind, string>;

type CaptureSlotFeedbackProps = {
  mismatch: boolean;
  refreshing: boolean;
  slot: CaptureSlotState;
  onRefreshStatus: () => void;
};

const refreshableStatuses = new Set<CaptureSlotState["status"]>(["queued", "running"]);

export function CaptureSlotFeedback({
  mismatch,
  refreshing,
  slot,
  onRefreshStatus,
}: CaptureSlotFeedbackProps) {
  const canRefreshStatus = Boolean(slot.jobId) && refreshableStatuses.has(slot.status);

  return (
    <>
      {mismatch ? <CaptureMismatchAlert detectedKind={slot.detectedKind} /> : null}
      {slot.transportError ? <CaptureTransportError error={slot.transportError} /> : null}
      {slot.jobFailure ? <CaptureJobFailure failure={slot.jobFailure} /> : null}
      {canRefreshStatus ? (
        <div className="grid gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 text-sm text-[var(--color-text-primary)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
    <div
      className="rounded-md border border-[var(--color-warning)]/60 bg-[var(--color-warning)]/20 p-3 text-sm text-[var(--color-text-primary)]"
      role="alert"
    >
      OCR判定は <strong>{detectedKind ? slotKindLabels[detectedKind] : "別の分類"}</strong>{" "}
      でした。画像を正しい分類へ移動してから、もう一度読み取りを開始してください。
    </div>
  );
}

function CaptureTransportError({
  error,
}: {
  error: NonNullable<CaptureSlotState["transportError"]>;
}) {
  return (
    <div
      className="rounded-md border border-[var(--color-danger)]/45 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-text-primary)]"
      role="alert"
    >
      <strong>{error.title}</strong>
      <p className="mt-1">{error.detail}</p>
    </div>
  );
}

function CaptureJobFailure({ failure }: { failure: NonNullable<CaptureSlotState["jobFailure"]> }) {
  return (
    <div
      className="rounded-md border border-[var(--color-danger)]/45 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-text-primary)]"
      role="alert"
    >
      <strong>画像を読み取れませんでした</strong>
      <p className="mt-1">この分類の読み取り結果は作成されていません。</p>
      <p className="mt-1">
        {failure.userAction ?? "画像を確認して、もう一度読み取りを開始してください。"}
      </p>
    </div>
  );
}
