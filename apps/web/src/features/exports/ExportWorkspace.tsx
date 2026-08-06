import { ArrowLeft } from "lucide-react";

import { LinkButton } from "@/shared/ui/actions/LinkButton";
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
  onCandidatePageChange: (page: number) => void;
  onCandidateRetry: () => void;
  onDownload: () => void;
  onFormatChange: (format: ExportFormat) => void;
  onResetConditions: () => void;
  onScopeChange: (scope: ExportScope) => void;
  returnTo?: string | undefined;
  view: ExportViewModel;
};

export function ExportWorkspace({
  isPending,
  onCandidateChange,
  onCandidatePageChange,
  onCandidateRetry,
  onDownload,
  onFormatChange,
  onResetConditions,
  onScopeChange,
  returnTo,
  view,
}: ExportWorkspaceProps) {
  return (
    <PageFrame width="narrow">
      {returnTo ? (
        <div>
          <LinkButton
            icon={<ArrowLeft aria-hidden="true" className="size-4" />}
            size="sm"
            to={returnTo}
            variant="quiet"
          >
            前の画面へ戻る
          </LinkButton>
        </div>
      ) : null}
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
          onPageChange={onCandidatePageChange}
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
