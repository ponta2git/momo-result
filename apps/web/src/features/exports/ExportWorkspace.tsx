import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

import { ExportActionPanel } from "./ExportActionPanel";
import { ExportCandidateSelect } from "./ExportCandidateSelect";
import { ExportFormatSegment } from "./ExportFormatSegment";
import { ExportScopeSelector } from "./ExportScopeSelector";
import type { ExportFormat, ExportScope } from "./exportTypes";
import type { ExportViewModel } from "./exportViewModel";

type ExportWorkspaceProps = {
  isPending: boolean;
  onCandidateChange: (value: string) => void;
  onCandidateRetry: () => void;
  onDownload: () => void;
  onFormatChange: (format: ExportFormat) => void;
  onResetConditions: () => void;
  onScopeChange: (scope: ExportScope) => void;
  view: ExportViewModel;
};

export function ExportWorkspace({
  isPending,
  onCandidateChange,
  onCandidateRetry,
  onDownload,
  onFormatChange,
  onResetConditions,
  onScopeChange,
  view,
}: ExportWorkspaceProps) {
  return (
    <PageFrame width="narrow">
      <PageHeader title="CSV/TSV出力" />

      <section
        aria-label="出力条件"
        className="grid gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)] sm:p-5"
      >
        <div className="grid gap-2">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">出力範囲</p>
          <ExportScopeSelector disabled={isPending} scope={view.scope} onChange={onScopeChange} />
        </div>

        <ExportCandidateSelect
          disabled={isPending || view.candidateRefreshing}
          refreshing={view.candidateRefreshing}
          scope={view.scope}
          view={view.candidate}
          onChange={onCandidateChange}
          onRetry={onCandidateRetry}
        />

        <div className="grid gap-2">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">ファイル形式</p>
          <ExportFormatSegment
            disabled={isPending}
            format={view.format}
            onChange={onFormatChange}
          />
        </div>

        <ExportActionPanel
          isPending={isPending}
          view={view}
          onDownload={onDownload}
          onResetConditions={onResetConditions}
        />
      </section>
    </PageFrame>
  );
}
