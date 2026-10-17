import { useState } from "react";

import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

import { ExportCandidateSelect } from "./ExportCandidateSelect";
import { ExportDownloadAction } from "./ExportDownloadAction";
import { ExportFormatTabs } from "./ExportFormatTabs";
import { ExportScopeTabs } from "./ExportScopeTabs";
import type { ExportSetupControls } from "./useExportSetup";

type ExportSetupProps = {
  setup: ExportSetupControls;
};

export function ExportSetup({ setup }: ExportSetupProps) {
  const { candidate, conditions, download, view } = setup;
  const [downloadPending, setDownloadPending] = useState(false);
  const showDownloadAction =
    view.action.errors.length > 0 ||
    view.candidate.kind === "hidden" ||
    (view.candidate.kind === "ready" && view.candidate.selectionState === "resolved");

  return (
    <PageFrame width="narrow">
      <PageContentSurface
        aria-label="出力条件"
        className="grid gap-4"
        padding="compact"
        role="region"
      >
        <ExportScopeTabs
          disabled={downloadPending}
          scope={view.scope}
          onChange={conditions.changeScope}
        >
          <ExportCandidateSelect
            disabled={downloadPending || (view.candidateRefreshing && !candidate.scopeChanging)}
            refreshing={view.candidateRefreshing}
            scopeChanging={candidate.scopeChanging}
            scope={view.scope}
            view={view.candidate}
            onChange={candidate.change}
            onPageChange={candidate.changePage}
            onRetry={candidate.retryDirectory}
            onSelectedCandidateRetry={candidate.retrySelection}
            onScopeChange={conditions.changeScope}
          />
        </ExportScopeTabs>

        <ExportFormatTabs
          disabled={downloadPending}
          format={view.format}
          onChange={conditions.changeFormat}
        >
          <ExportDownloadAction
            {...download}
            visible={showDownloadAction}
            action={view.action}
            onPendingChange={setDownloadPending}
            onResetConditions={conditions.reset}
          />
        </ExportFormatTabs>
      </PageContentSurface>
    </PageFrame>
  );
}
