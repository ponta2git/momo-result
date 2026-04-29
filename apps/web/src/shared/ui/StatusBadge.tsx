type StatusBadgeProps = {
  status: string;
};

const toneByStatus: Record<string, string> = {
  empty: "border-white/10 bg-white/[0.05] text-ink-300",
  selected: "border-rail-blue/40 bg-rail-blue/10 text-sky-100",
  uploading: "border-rail-blue/40 bg-rail-blue/10 text-sky-100",
  uploaded: "border-rail-blue/40 bg-rail-blue/10 text-sky-100",
  queueing: "border-rail-gold/40 bg-rail-gold/10 text-yellow-100",
  queued: "border-rail-gold/40 bg-rail-gold/10 text-yellow-100",
  running: "border-rail-magenta/40 bg-rail-magenta/10 text-fuchsia-100",
  succeeded: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100",
  failed: "border-red-300/40 bg-red-400/10 text-red-100",
  cancelled: "border-slate-300/40 bg-slate-400/10 text-slate-100",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold tracking-wide ${toneByStatus[status] ?? toneByStatus.empty}`}
    >
      {status}
    </span>
  );
}
