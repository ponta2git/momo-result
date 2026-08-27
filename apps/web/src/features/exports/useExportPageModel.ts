import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import {
  DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
  DEFAULT_EXPORT_TIMEOUT_MS,
} from "@/features/exports/exportDownload";
import type {
  ExportFormat,
  ExportMatchesRequest,
  ExportScope,
} from "@/features/exports/exportTypes";
import {
  buildExportSearchParams,
  parseExportSearchParams,
  selectedIdForScope,
} from "@/features/exports/exportUrlState";
import { buildExportViewModel } from "@/features/exports/exportViewModel";
import type { ExportViewModel } from "@/features/exports/exportViewModel";
import { useExportCandidates } from "@/features/exports/useExportCandidates";
import { useExportDownload } from "@/features/exports/useExportDownload";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

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
  navigation: {
    returnTo?: string | undefined;
  };
  view: ExportViewModel;
};

/** Composes URL state and the candidate/download workflows into the export screen contract. */
export function useExportPageModel({
  downloadTimeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
  slowThresholdMs = DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
}: ExportPageModelParams): ExportPageModel {
  const [searchParams, setSearchParams] = useSearchParams();
  const serializedSearch = searchParams.toString();
  const { returnTo, urlState } = useMemo(() => {
    const params = new URLSearchParams(serializedSearch);
    return {
      returnTo: sanitizeReturnTo(params.get("returnTo")),
      urlState: parseExportSearchParams(params),
    };
  }, [serializedSearch]);
  const selectedId = selectedIdForScope(urlState, urlState.scope);
  const candidates = useExportCandidates({ scope: urlState.scope, selectedId });
  const download = useExportDownload({
    slowThresholdMs,
    timeoutMs: downloadTimeoutMs,
  });

  const defaultCandidateId =
    candidates.view.kind === "ready" ? candidates.view.selectedId : undefined;
  useEffect(() => {
    if (
      urlState.errors.length > 0 ||
      urlState.scope === "all" ||
      selectedId ||
      !defaultCandidateId
    ) {
      return;
    }

    const nextParams = buildExportSearchParams({
      format: urlState.format,
      scope: urlState.scope,
      selectedId: defaultCandidateId,
    });
    if (returnTo) nextParams.set("returnTo", returnTo);
    setSearchParams(nextParams, { replace: true });
  }, [
    defaultCandidateId,
    returnTo,
    selectedId,
    setSearchParams,
    urlState.errors.length,
    urlState.format,
    urlState.scope,
  ]);

  const updateSearch = (
    format: ExportFormat,
    scope: ExportScope,
    nextSelectedId?: string,
  ): void => {
    download.clearResult();
    const nextParams = buildExportSearchParams({ format, scope, selectedId: nextSelectedId });
    if (returnTo) nextParams.set("returnTo", returnTo);
    setSearchParams(nextParams, { replace: true });
  };
  const request: ExportMatchesRequest = {
    format: urlState.format,
    scope: urlState.scope,
    heldEventId: urlState.heldEventId,
    matchId: urlState.matchId,
    seasonMasterId: urlState.seasonMasterId,
  };
  const view = buildExportViewModel({
    candidate: candidates.view,
    candidateRefreshing: candidates.refreshing,
    isPending: download.pending,
    isSlow: download.slow,
    lastResult: download.result,
    urlState,
  });

  return {
    candidate: {
      change: (nextSelectedId) => {
        if (!candidates.selectCandidate(nextSelectedId)) return;
        updateSearch(urlState.format, urlState.scope, nextSelectedId);
      },
      changePage: candidates.setPage,
      retryDirectory: candidates.retry,
      retrySelection: candidates.retrySelectedCandidate,
    },
    conditions: {
      changeFormat: (nextFormat) => updateSearch(nextFormat, urlState.scope, selectedId),
      changeScope: (nextScope) => {
        candidates.reset();
        updateSearch(urlState.format, nextScope);
      },
      reset: () => {
        candidates.reset();
        updateSearch("csv", "all");
      },
    },
    download: {
      pending: download.pending,
      start: () => download.start(request),
    },
    navigation: { returnTo },
    view,
  };
}
