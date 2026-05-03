type StatusBadgeProps = {
  status: string;
};

const toneByStatus: Record<string, string> = {
  empty:
    "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
  selected:
    "border-[var(--color-action)]/45 bg-[var(--color-action)]/10 text-[var(--color-action)]",
  uploading:
    "border-[var(--color-action)]/45 bg-[var(--color-action)]/10 text-[var(--color-action)]",
  uploaded:
    "border-[var(--color-action)]/45 bg-[var(--color-action)]/10 text-[var(--color-action)]",
  queueing:
    "border-[var(--color-warning)]/60 bg-[var(--color-warning)]/20 text-[var(--color-text-primary)]",
  queued:
    "border-[var(--color-warning)]/60 bg-[var(--color-warning)]/20 text-[var(--color-text-primary)]",
  running: "border-[var(--color-action)]/45 bg-[var(--color-action)]/10 text-[var(--color-action)]",
  succeeded:
    "border-[var(--color-success)]/50 bg-[var(--color-success)]/12 text-[var(--color-text-primary)]",
  failed: "border-[var(--color-danger)]/45 bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  cancelled:
    "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
};

const labelByStatus: Record<string, string> = {
  empty: "未配置",
  selected: "OCR待ち",
  uploading: "画像送信中",
  uploaded: "送信済み",
  queueing: "OCR依頼中",
  queued: "OCR待機中",
  running: "OCR実行中",
  succeeded: "下書き保存済み",
  failed: "要確認",
  cancelled: "キャンセル済み",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold tracking-wide ${toneByStatus[status] ?? toneByStatus.empty}`}
    >
      {labelByStatus[status] ?? status}
    </span>
  );
}
