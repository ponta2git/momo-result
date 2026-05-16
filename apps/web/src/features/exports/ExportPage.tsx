import {
  DEFAULT_EXPORT_TIMEOUT_MS,
  DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
} from "@/features/exports/exportDownload";
import { ExportWorkspace } from "@/features/exports/ExportWorkspace";
import { useExportPageController } from "@/features/exports/useExportPageController";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";

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
    <>
      <LiveRegion message={controller.liveMessage} />
      <ExportWorkspace
        isPending={controller.isPending}
        view={controller.view}
        onCandidateChange={controller.onCandidateChange}
        onDownload={controller.onDownload}
        onFormatChange={controller.onFormatChange}
        onScopeChange={controller.onScopeChange}
      />
    </>
  );
}
