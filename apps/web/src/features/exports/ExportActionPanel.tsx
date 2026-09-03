import { Download } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

import { ExportDownloadProgress } from "./ExportDownloadProgress";
import { ExportDownloadResult } from "./ExportDownloadResult";
import type { ExportViewModel } from "./exportViewModel";

type ExportActionPanelProps = {
  isPending: boolean;
  onDownload: () => void;
  onResetConditions: () => void;
  view: ExportViewModel;
};

export function ExportActionPanel({
  isPending,
  onDownload,
  onResetConditions,
  view,
}: ExportActionPanelProps) {
  return (
    <div aria-busy={isPending || undefined} className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-base font-semibold text-pretty text-[var(--color-text-primary)]">
          {view.summaryText}
        </p>
        <p className="text-sm text-pretty text-[var(--color-text-secondary)]">
          確定済みのみ・1プレーヤー1行・金額は万円
        </p>
      </div>

      {view.errors.length > 0 ? (
        <Notice
          action={
            <Button size="sm" onClick={onResetConditions}>
              初期条件へ戻す
            </Button>
          }
          tone="danger"
          title="出力条件を確認"
        >
          {view.errors.join(" ")}
        </Notice>
      ) : (
        <>
          <div className="grid w-full sm:w-fit">
            <Button
              disabled={!view.canDownload}
              icon={<Download aria-hidden="true" />}
              pending={isPending}
              pendingLabel="作成中…"
              size="lg"
              onClick={onDownload}
            >
              {view.actionLabel}
            </Button>
          </div>

          <ExportDownloadProgress isPending={isPending} isSlow={view.isSlow} />
          <ExportDownloadResult result={view.result} onRetry={onDownload} />
        </>
      )}
    </div>
  );
}
