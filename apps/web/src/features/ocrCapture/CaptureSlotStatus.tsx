import { motion } from "motion/react";

import { cn } from "@/shared/ui/cn";
import { momoTransition } from "@/shared/ui/motion/variants";

const statusToneClass: Record<string, string> = {
  cancelled:
    "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
  empty:
    "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
  failed: "border-[var(--color-danger)]/45 bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  queued:
    "border-[var(--color-warning)]/60 bg-[var(--color-warning)]/20 text-[var(--color-text-primary)]",
  queueing:
    "border-[var(--color-warning)]/60 bg-[var(--color-warning)]/20 text-[var(--color-text-primary)]",
  running: "border-[var(--color-action)]/45 bg-[var(--color-action)]/10 text-[var(--color-action)]",
  selected:
    "border-[var(--color-action)]/45 bg-[var(--color-action)]/10 text-[var(--color-action)]",
  succeeded:
    "border-[var(--color-success)]/50 bg-[var(--color-success)]/12 text-[var(--color-text-primary)]",
  uploaded:
    "border-[var(--color-action)]/45 bg-[var(--color-action)]/10 text-[var(--color-action)]",
  uploading:
    "border-[var(--color-action)]/45 bg-[var(--color-action)]/10 text-[var(--color-action)]",
};

const statusLabel: Record<string, string> = {
  cancelled: "キャンセル済み",
  empty: "画像待ち",
  failed: "要確認",
  queued: "読み取り待ち",
  queueing: "準備中",
  running: "読み取り中",
  selected: "配置済み",
  succeeded: "確認待ち",
  uploaded: "送信済み",
  uploading: "画像送信中",
};

export function CaptureStatusBadge({ status }: { status: string }) {
  return (
    <motion.span
      key={status}
      animate={{ opacity: 1 }}
      className={cn(
        "inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
        "shrink-0 whitespace-nowrap",
        statusToneClass[status] ?? statusToneClass["empty"],
      )}
      initial={{ opacity: 0 }}
      transition={momoTransition}
    >
      {statusLabel[status] ?? status}
    </motion.span>
  );
}
