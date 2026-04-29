type StatusBadgeProps = {
  status: string;
};

const toneByStatus: Record<string, string> = {
  empty: "border-line-soft bg-white/[0.035] text-ink-300",
  selected: "border-rail-blue/35 bg-rail-blue/10 text-sky-100",
  uploading: "border-rail-blue/35 bg-rail-blue/10 text-sky-100",
  uploaded: "border-rail-blue/35 bg-rail-blue/10 text-sky-100",
  queueing: "border-rail-gold/38 bg-rail-gold/10 text-yellow-100",
  queued: "border-rail-gold/38 bg-rail-gold/10 text-yellow-100",
  running: "border-rail-magenta/34 bg-rail-magenta/10 text-fuchsia-100",
  succeeded: "border-route-green/40 bg-route-green/12 text-emerald-100",
  failed: "border-red-300/34 bg-red-400/10 text-red-100",
  cancelled: "border-ink-400/35 bg-ink-400/10 text-ink-200",
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
