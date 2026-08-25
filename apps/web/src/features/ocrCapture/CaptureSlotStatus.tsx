import type { SlotStatus } from "@/features/ocrCapture/captureState";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
import type { StatusBadgeTone } from "@/shared/ui/status/StatusBadge";

type CaptureStatusViewModel = {
  busy?: boolean | undefined;
  label: string;
  tone: StatusBadgeTone;
};

const captureStatusViewModel = {
  cancelled: { label: "キャンセル済み", tone: "neutral" },
  empty: { label: "画像待ち", tone: "neutral" },
  failed: { label: "要確認", tone: "danger" },
  queued: { busy: true, label: "読み取り待ち", tone: "warning" },
  queueing: { busy: true, label: "準備中", tone: "warning" },
  running: { busy: true, label: "読み取り中", tone: "info" },
  selected: { label: "配置済み", tone: "neutral" },
  succeeded: { label: "確認待ち", tone: "success" },
  uploaded: { label: "送信済み", tone: "info" },
  uploading: { busy: true, label: "画像送信中", tone: "info" },
} as const satisfies Record<SlotStatus, CaptureStatusViewModel>;

export function CaptureStatusBadge({ status }: { status: SlotStatus }) {
  const model: CaptureStatusViewModel = captureStatusViewModel[status];
  return <StatusBadge announceChanges busy={model.busy} label={model.label} tone={model.tone} />;
}
