import { motion } from "motion/react";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import type { SlotKind } from "@/shared/api/enums";
import { Button } from "@/shared/ui/actions/Button";
import { momoPanelTransition } from "@/shared/ui/motion/variants";

const slotKindLabels = {
  incident_log: "事件簿",
  revenue: "収益",
  total_assets: "総資産",
} as const satisfies Record<SlotKind, string>;

const pollingPausedMessage: Record<string, string> = {
  timeout: "読み取り処理の自動確認を停止しました。状態を確認するには手動で更新してください。",
  transient_errors: "状態確認リクエストが混雑しています。少し待ってから手動で更新してください。",
};

type CaptureSlotFeedbackProps = {
  mismatch: boolean;
  slot: CaptureSlotState;
  onManualRefresh: () => void;
};

export function CaptureSlotFeedback({
  mismatch,
  slot,
  onManualRefresh,
}: CaptureSlotFeedbackProps) {
  return (
    <>
      {mismatch ? <CaptureMismatchAlert detectedKind={slot.detectedKind} /> : null}
      {slot.transportError ? <CaptureTransportError error={slot.transportError} /> : null}
      {slot.jobFailure ? <CaptureJobFailure failure={slot.jobFailure} /> : null}
      {slot.pollingPausedReason && !["succeeded", "failed", "cancelled"].includes(slot.status) ? (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-warning)]/60 bg-[var(--color-warning)]/20 p-3 text-sm text-[var(--color-text-primary)]">
          {pollingPausedMessage[slot.pollingPausedReason]}
          <Button className="ml-3" variant="secondary" onClick={onManualRefresh}>
            状態を確認
          </Button>
        </div>
      ) : null}
    </>
  );
}

function CaptureMismatchAlert({ detectedKind }: { detectedKind?: SlotKind | undefined }) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-warning)]/60 bg-[var(--color-warning)]/20 p-3 text-sm text-[var(--color-text-primary)]"
      initial={{ opacity: 0, y: 4 }}
      role="alert"
      transition={momoPanelTransition}
    >
      OCR判定は <strong>{detectedKind ? slotKindLabels[detectedKind] : "別の分類"}</strong>{" "}
      でした。画像を正しい分類へ移動してから、もう一度読み取りを開始してください。
    </motion.div>
  );
}

function CaptureTransportError({
  error,
}: {
  error: NonNullable<CaptureSlotState["transportError"]>;
}) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/45 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-text-primary)]"
      initial={{ opacity: 0, y: 4 }}
      role="alert"
      transition={momoPanelTransition}
    >
      <strong>{error.title}</strong>
      <p className="mt-1">{error.detail}</p>
    </motion.div>
  );
}

function CaptureJobFailure({ failure }: { failure: NonNullable<CaptureSlotState["jobFailure"]> }) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/45 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-text-primary)]"
      initial={{ opacity: 0, y: 4 }}
      role="alert"
      transition={momoPanelTransition}
    >
      <strong>{failure.code}</strong>
      <p className="mt-1">{failure.userAction ?? failure.message}</p>
    </motion.div>
  );
}
