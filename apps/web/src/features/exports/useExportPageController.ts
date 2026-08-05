import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  DEFAULT_EXPORT_TIMEOUT_MS,
  DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
  downloadExportMatches,
} from "@/features/exports/exportDownload";
import type { ExportFormat, ExportScope } from "@/features/exports/exportTypes";
import {
  buildExportSearchParams,
  parseExportSearchParams,
  selectedIdForScope,
} from "@/features/exports/exportUrlState";
import { buildExportViewModel, failedResultView } from "@/features/exports/exportViewModel";
import type { ExportDownloadResultView } from "@/features/exports/exportViewModel";
import { useExportCandidates } from "@/features/exports/useExportCandidates";

export type ExportPageControllerParams = {
  downloadTimeoutMs?: number | undefined;
  slowThresholdMs?: number | undefined;
};

export function useExportPageController({
  downloadTimeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
  slowThresholdMs = DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
}: ExportPageControllerParams) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = parseExportSearchParams(searchParams);
  const [lastResult, setLastResult] = useState<ExportDownloadResultView | undefined>();
  const [downloadStartedAt, setDownloadStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const selectedId = selectedIdForScope(urlState, urlState.scope);
  const candidates = useExportCandidates({ scope: urlState.scope, selectedId });
  const candidateView = candidates.view;

  useEffect(() => {
    if (
      urlState.errors.length === 0 &&
      urlState.scope !== "all" &&
      !selectedIdForScope(urlState, urlState.scope) &&
      candidateView.kind === "ready" &&
      candidateView.selectedId
    ) {
      setSearchParams(
        buildExportSearchParams({
          format: urlState.format,
          scope: urlState.scope,
          selectedId: candidateView.selectedId,
        }),
        { replace: true },
      );
    }
  }, [candidateView, setSearchParams, urlState]);

  useEffect(() => {
    if (downloadStartedAt === null) {
      setElapsedMs(0);
      return;
    }
    const intervalId = window.setInterval(() => {
      setElapsedMs(Date.now() - downloadStartedAt);
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [downloadStartedAt]);

  const mutation = useMutation({
    mutationFn: () => {
      setDownloadStartedAt(Date.now());
      setElapsedMs(0);
      setLastResult(undefined);
      return downloadExportMatches(
        {
          format: urlState.format,
          scope: urlState.scope,
          heldEventId: urlState.heldEventId,
          matchId: urlState.matchId,
          seasonMasterId: urlState.seasonMasterId,
        },
        { timeoutMs: downloadTimeoutMs },
      );
    },
    onSettled: () => setDownloadStartedAt(null),
    onSuccess: (outcome) => {
      if (outcome.kind === "download_started") {
        setLastResult({
          fileName: outcome.fileName,
          format: outcome.format,
          kind: "success",
          startedAt: outcome.startedAt,
        });
        return;
      }
      if (outcome.kind === "timeout") {
        setLastResult({
          detail: outcome.detail,
          kind: "timeout",
          title: outcome.title,
        });
        return;
      }
      const failed = failedResultView(outcome.error);
      setLastResult(failed);
    },
  });

  const updateSearch = (
    format: ExportFormat,
    scope: ExportScope,
    nextSelectedId?: string,
  ): void => {
    setLastResult(undefined);
    setSearchParams(buildExportSearchParams({ format, scope, selectedId: nextSelectedId }), {
      replace: true,
    });
  };

  const view = buildExportViewModel({
    candidate: candidateView,
    candidateRefreshing: candidates.refreshing,
    elapsedMs,
    isPending: mutation.isPending,
    lastResult,
    slowThresholdMs,
    urlState,
  });

  return {
    isPending: mutation.isPending,
    onCandidateChange: (nextSelectedId: string) => {
      if (!candidates.selectCandidate(nextSelectedId)) return;
      updateSearch(urlState.format, urlState.scope, nextSelectedId);
    },
    onCandidatePageChange: candidates.setPage,
    onCandidateRetry: candidates.retry,
    onDownload: () => mutation.mutate(),
    onFormatChange: (nextFormat: ExportFormat) =>
      updateSearch(nextFormat, urlState.scope, selectedId),
    onResetConditions: () => {
      candidates.reset();
      updateSearch("csv", "all");
    },
    onScopeChange: (nextScope: ExportScope) => {
      candidates.reset();
      updateSearch(urlState.format, nextScope);
    },
    view,
  };
}
