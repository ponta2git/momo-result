import { Download } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

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
    <aside className="grid gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)] lg:sticky lg:top-4">
      <div>
        <p className="text-xs font-semibold text-[var(--color-text-muted)]">出力内容</p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
          書き出し内容の確認
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          内容を確認してからファイルを作成します。
        </p>
      </div>

      <dl className="grid gap-2 border-y border-[var(--color-border)] py-3">
        {view.ticketRows.map((row) => (
          <div key={row.label} className="grid grid-cols-[6rem_1fr] gap-3 text-sm">
            <dt className="text-[var(--color-text-muted)]">{row.label}</dt>
            <dd className="min-w-0 font-medium break-words text-[var(--color-text-primary)]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <Notice tone="info" title="ファイルの内容">
        1プレーヤー1行で出力します。金額は万円単位です。
      </Notice>

      {view.disableReason ? (
        <Notice tone="warning" title="出力条件を確認してください">
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
    </aside>
  );
}
