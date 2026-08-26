import { ArrowLeft } from "lucide-react";

import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

import { ExportActionPanel } from "./ExportActionPanel";
import { ExportCandidateSelect } from "./ExportCandidateSelect";
import { ExportFormatTabs } from "./ExportFormatTabs";
import { ExportScopeTabs } from "./ExportScopeTabs";
import type { ExportFormat, ExportScope } from "./exportTypes";
import type { ExportViewModel } from "./exportViewModel";

type ExportWorkspaceProps = {
  isPending: boolean;
  onCandidateChange: (value: string) => void;
  onCandidatePageChange: (page: number) => void;
  onCandidateRetry: () => void;
  onSelectedCandidateRetry: () => void;
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
  onSelectedCandidateRetry,
  onDownload,
  onFormatChange,
  onResetConditions,
  onScopeChange,
  returnTo,
  view,
}: ExportWorkspaceProps) {
  const showActionPanel =
    view.errors.length > 0 ||
    view.candidate.kind === "hidden" ||
    (view.candidate.kind === "ready" && view.candidate.selectionState === "resolved");

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

      <PageContentSurface
        aria-label="出力条件"
        className="grid gap-4"
        padding="compact"
        role="region"
      >
        <ExportScopeTabs disabled={isPending} scope={view.scope} onChange={onScopeChange}>
          <ExportCandidateSelect
            disabled={isPending || view.candidateRefreshing}
            refreshing={view.candidateRefreshing}
            scope={view.scope}
            view={view.candidate}
            onChange={onCandidateChange}
            onPageChange={onCandidatePageChange}
            onRetry={onCandidateRetry}
            onSelectedCandidateRetry={onSelectedCandidateRetry}
            onScopeChange={onScopeChange}
          />
        </ExportScopeTabs>

        <ExportFormatTabs disabled={isPending} format={view.format} onChange={onFormatChange}>
          {showActionPanel ? (
            <ExportActionPanel
              isPending={isPending}
              view={view}
              onDownload={onDownload}
              onResetConditions={onResetConditions}
            />
          ) : null}
        </ExportFormatTabs>
      </PageContentSurface>
    </PageFrame>
  );
}
