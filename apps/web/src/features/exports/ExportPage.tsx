import {
  DEFAULT_EXPORT_TIMEOUT_MS,
  DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
} from "@/features/exports/exportDownload";
import { ExportSetup } from "@/features/exports/ExportSetup";
import { useExportSetup } from "@/features/exports/useExportSetup";

type ExportPageProps = {
  downloadTimeoutMs?: number | undefined;
  slowThresholdMs?: number | undefined;
};

export function ExportPage({
  downloadTimeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
  slowThresholdMs = DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
}: ExportPageProps) {
  const setup = useExportSetup({ downloadTimeoutMs, slowThresholdMs });

  return <ExportSetup setup={setup} />;
}
