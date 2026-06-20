import { Download } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { momoPanelTransition, momoTransition } from "@/shared/ui/motion/variants";

import { ExportDownloadProgress } from "./ExportDownloadProgress";
import { ExportDownloadResult } from "./ExportDownloadResult";
import type { ExportViewModel } from "./exportViewModel";

type ExportTicketProps = {
  isPending: boolean;
  onDownload: () => void;
  view: ExportViewModel;
};

export function ExportTicket({ isPending, onDownload, view }: ExportTicketProps) {
  return (
    <motion.aside
      aria-busy={isPending || undefined}
      animate={{ opacity: 1, y: 0 }}
      className="relative grid gap-4 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)] lg:sticky lg:top-4"
      initial={{ opacity: 0, y: 6 }}
      transition={momoPanelTransition}
    >
      <img
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute top-3 right-3 hidden size-16 rotate-3 object-contain opacity-95 sm:block"
        decoding="async"
        loading="lazy"
        src="/ticket.png"
      />
      <div className="relative z-[var(--z-base)] pr-0 sm:pr-20">
        <p className="text-xs font-semibold text-[var(--color-text-muted)]">出力内容</p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
          書き出し内容
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          作成前に、範囲と形式を確認します。
        </p>
      </div>

      <dl className="grid gap-2 border-y border-[var(--color-border)] py-3">
        {view.ticketRows.map((row) => (
          <motion.div
            key={row.label}
            className="grid grid-cols-[6rem_1fr] gap-3 text-sm"
            layout
            transition={momoTransition}
          >
            <dt className="text-[var(--color-text-muted)]">{row.label}</dt>
            <dd className="min-w-0 font-medium break-words text-[var(--color-text-primary)]">
              {row.value}
            </dd>
          </motion.div>
        ))}
      </dl>

      <Notice tone="info" title="ファイル仕様">
        1プレーヤー1行で出力します。金額の単位は万円です。
      </Notice>

      {view.disableReason ? (
        <Notice tone="warning" title="出力条件を確認">
          {view.disableReason}
        </Notice>
      ) : null}

      <Button
        className="w-full lg:w-auto"
        disabled={!view.canDownload}
        icon={<Download className="size-4" />}
        pending={isPending}
        pendingLabel="作成中…"
        size="lg"
        onClick={onDownload}
      >
        {view.actionLabel}
      </Button>

      <ExportDownloadProgress isPending={isPending} isSlow={view.isSlow} />
      <ExportDownloadResult result={view.result} onRetry={onDownload} />
    </motion.aside>
  );
}
