import {
  DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
  DEFAULT_EXPORT_TIMEOUT_MS,
} from "@/features/exports/exportDownload";
import { buildExportSelectionView } from "@/features/exports/exportPresentation";
import type { ExportSelectionView } from "@/features/exports/exportPresentation";
import type {
  ExportFormat,
  ExportScope,
  ExportMatchesRequest,
} from "@/features/exports/exportTypes";
import { useExportSelection } from "@/features/exports/useExportSelection";

export type ExportSetupOptions = {
  downloadTimeoutMs?: number | undefined;
  slowThresholdMs?: number | undefined;
};

export type ExportSetupControls = {
  readonly candidate: {
    readonly change: (selectedId: string) => void;
    readonly changePage: (page: number) => void;
    readonly retryDirectory: () => void;
    readonly retrySelection: () => void;
    readonly scopeChanging: boolean;
  };
  readonly conditions: {
    readonly changeFormat: (format: ExportFormat) => void;
    readonly changeScope: (scope: ExportScope) => void;
    readonly reset: () => void;
  };
  readonly download: {
    readonly available: boolean;
    readonly request: Readonly<ExportMatchesRequest> | undefined;
    readonly slowThresholdMs: number;
    readonly timeoutMs: number;
  };
  readonly view: ExportSelectionView;
};

/** The page owns URL conditions and candidate selection; the action panel owns downloading. */
export function useExportSetup({
  downloadTimeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
  slowThresholdMs = DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
}: ExportSetupOptions): ExportSetupControls {
  const selection = useExportSelection();

  const view = buildExportSelectionView({
    candidate: selection.candidateView,
    candidateRefreshing: selection.candidateRefreshing,
    urlState: selection.state,
  });

  return {
    candidate: selection.candidate,
    conditions: selection.conditions,
    download: {
      available: selection.available,
      request: selection.request,
      slowThresholdMs,
      timeoutMs: downloadTimeoutMs,
    },
    view,
  };
}
