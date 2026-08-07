import {
  DEFAULT_EXPORT_TIMEOUT_MS,
  DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
} from "@/features/exports/exportDownload";
import { ExportWorkspace } from "@/features/exports/ExportWorkspace";
import { useExportPageController } from "@/features/exports/useExportPageController";

type ExportPageProps = {
  downloadTimeoutMs?: number | undefined;
  slowThresholdMs?: number | undefined;
};

export function ExportPage({
  downloadTimeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
  slowThresholdMs = DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
}: ExportPageProps) {
  const controller = useExportPageController({ downloadTimeoutMs, slowThresholdMs });

  return (
    <ExportWorkspace
      isPending={controller.isPending}
      returnTo={controller.returnTo}
      view={controller.view}
      onCandidateChange={controller.onCandidateChange}
      onCandidatePageChange={controller.onCandidatePageChange}
      onCandidateRetry={controller.onCandidateRetry}
      onDownload={controller.onDownload}
      onFormatChange={controller.onFormatChange}
      onResetConditions={controller.onResetConditions}
      onScopeChange={controller.onScopeChange}
    />
  );
}
