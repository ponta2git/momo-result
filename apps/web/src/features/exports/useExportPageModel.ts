import {
  DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
  DEFAULT_EXPORT_TIMEOUT_MS,
} from "@/features/exports/exportDownload";
import type { ExportFormat, ExportScope } from "@/features/exports/exportTypes";
import { buildExportViewModel } from "@/features/exports/exportViewModel";
import type { ExportViewModel } from "@/features/exports/exportViewModel";
import { useExportDownload } from "@/features/exports/useExportDownload";
import { useExportSelection } from "@/features/exports/useExportSelection";

export type ExportPageModelParams = {
  downloadTimeoutMs?: number | undefined;
  slowThresholdMs?: number | undefined;
};

export type ExportPageModel = {
  candidate: {
    change: (selectedId: string) => void;
    changePage: (page: number) => void;
    retryDirectory: () => void;
    retrySelection: () => void;
    scopeChanging: boolean;
  };
  conditions: {
    changeFormat: (format: ExportFormat) => void;
    changeScope: (scope: ExportScope) => void;
    reset: () => void;
  };
  download: {
    pending: boolean;
    start: () => void;
  };
  view: ExportViewModel;
};

/** Composes URL state and the candidate/download workflows into the export screen contract. */
export function useExportPageModel({
  downloadTimeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
  slowThresholdMs = DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
}: ExportPageModelParams): ExportPageModel {
  const selection = useExportSelection();
  const download = useExportDownload({
    request: selection.request,
    available: selection.available,
    slowThresholdMs,
    timeoutMs: downloadTimeoutMs,
  });

  const view = buildExportViewModel({
    candidate: selection.candidateView,
    candidateRefreshing: selection.candidateRefreshing,
    isPending: download.pending,
    isSlow: download.slow,
    lastResult: download.result,
    urlState: selection.state,
  });

  return {
    candidate: selection.candidate,
    conditions: selection.conditions,
    download: {
      pending: download.pending,
      start: download.start,
    },
    view,
  };
}
