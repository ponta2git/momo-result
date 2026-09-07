import { ArrowLeft } from "lucide-react";

import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

import { ExportActionPanel } from "./ExportActionPanel";
import { ExportCandidateSelect } from "./ExportCandidateSelect";
import { ExportFormatTabs } from "./ExportFormatTabs";
import { ExportScopeTabs } from "./ExportScopeTabs";
import type { ExportPageModel } from "./useExportPageModel";

type ExportWorkspaceProps = {
  model: ExportPageModel;
};

export function ExportWorkspace({ model }: ExportWorkspaceProps) {
  const { candidate, conditions, download, navigation, view } = model;
  const showActionPanel =
    view.errors.length > 0 ||
    view.candidate.kind === "hidden" ||
    (view.candidate.kind === "ready" && view.candidate.selectionState === "resolved");

  return (
    <PageFrame width="narrow">
      {navigation.returnTo ? (
        <div>
          <LinkButton
            icon={<ArrowLeft aria-hidden="true" />}
            size="sm"
            to={navigation.returnTo}
            variant="quiet"
          >
            前の画面へ戻る
          </LinkButton>
        </div>
      ) : null}
      <PageContentSurface
        aria-label="出力条件"
        className="grid gap-4"
        padding="compact"
        role="region"
      >
        <ExportScopeTabs
          disabled={download.pending}
          scope={view.scope}
          onChange={conditions.changeScope}
        >
          <ExportCandidateSelect
            disabled={download.pending || (view.candidateRefreshing && !candidate.scopeChanging)}
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
          disabled={download.pending}
          format={view.format}
          onChange={conditions.changeFormat}
        >
          {showActionPanel ? (
            <ExportActionPanel
              isPending={download.pending}
              view={view}
              onDownload={download.start}
              onResetConditions={conditions.reset}
            />
          ) : null}
        </ExportFormatTabs>
      </PageContentSurface>
    </PageFrame>
  );
}
