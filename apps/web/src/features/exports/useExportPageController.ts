import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

export type ExportPageControllerParams = {
  downloadTimeoutMs?: number | undefined;
  slowThresholdMs?: number | undefined;
};

export function useExportPageController({
  downloadTimeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
  slowThresholdMs = DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
}: ExportPageControllerParams) {
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const urlState = parseExportSearchParams(searchParams);
  const [lastResult, setLastResult] = useState<ExportDownloadResultView | undefined>();
  const [isSlow, setIsSlow] = useState(false);
  const slowTimerRef = useRef<number | undefined>(undefined);
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
      const nextParams = buildExportSearchParams({
        format: urlState.format,
        scope: urlState.scope,
        selectedId: candidateView.selectedId,
      });
      if (returnTo) nextParams.set("returnTo", returnTo);
      setSearchParams(nextParams, { replace: true });
    }
  }, [candidateView, returnTo, setSearchParams, urlState]);

  useEffect(
    () => () => {
      if (slowTimerRef.current !== undefined) {
        window.clearTimeout(slowTimerRef.current);
      }
    },
    [],
  );

  const mutation = useMutation({
    mutationFn: () =>
      downloadExportMatches(
        {
          format: urlState.format,
          scope: urlState.scope,
          heldEventId: urlState.heldEventId,
          matchId: urlState.matchId,
          seasonMasterId: urlState.seasonMasterId,
        },
        { timeoutMs: downloadTimeoutMs },
      ),
    onMutate: () => {
      if (slowTimerRef.current !== undefined) {
        window.clearTimeout(slowTimerRef.current);
      }
      setIsSlow(false);
      setLastResult(undefined);
      slowTimerRef.current = window.setTimeout(() => {
        slowTimerRef.current = undefined;
        setIsSlow(true);
      }, slowThresholdMs);
    },
    onSettled: () => {
      if (slowTimerRef.current !== undefined) {
        window.clearTimeout(slowTimerRef.current);
        slowTimerRef.current = undefined;
      }
      setIsSlow(false);
    },
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
    const nextParams = buildExportSearchParams({ format, scope, selectedId: nextSelectedId });
    if (returnTo) nextParams.set("returnTo", returnTo);
    setSearchParams(nextParams, { replace: true });
  };

  const view = buildExportViewModel({
    candidate: candidateView,
    candidateRefreshing: candidates.refreshing,
    isPending: mutation.isPending,
    isSlow,
    lastResult,
    urlState,
  });

  return {
    isPending: mutation.isPending,
    returnTo,
    onCandidateChange: (nextSelectedId: string) => {
      if (!candidates.selectCandidate(nextSelectedId)) return;
      updateSearch(urlState.format, urlState.scope, nextSelectedId);
    },
    onCandidatePageChange: candidates.setPage,
    onCandidateRetry: candidates.retry,
    onSelectedCandidateRetry: candidates.retrySelectedCandidate,
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
