import { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { ExportFormat, ExportScope } from "@/features/exports/exportTypes";
import {
  buildExportSearchParams,
  parseExportSearchParams,
  resolveExportSelection,
  selectedIdForScope,
} from "@/features/exports/exportUrlState";
import { useExportCandidates } from "@/features/exports/useExportCandidates";

/** Owns candidate selection and its URL, including adoption of the displayed default. */
export function useExportSelection() {
  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const serializedSearch = searchParams.toString();
  const state = useMemo(
    () => parseExportSearchParams(new URLSearchParams(serializedSearch)),
    [serializedSearch],
  );
  const selectedId = selectedIdForScope(state, state.scope);
  const candidates = useExportCandidates({ scope: state.scope, selectedId });
  const selection = resolveExportSelection(state, candidates.view);

  useEffect(() => {
    if (selection.normalizedSearch === undefined) return;
    void navigate({ search: selection.normalizedSearch, hash }, { replace: true });
  }, [hash, navigate, selection.normalizedSearch]);

  const update = (format: ExportFormat, scope: ExportScope, nextSelectedId?: string) => {
    const next = buildExportSearchParams({ format, scope, selectedId: nextSelectedId });
    void navigate({ search: next.toString(), hash }, { replace: true });
  };

  return {
    state,
    request: selection.request,
    available: selection.available,
    candidateView: candidates.view,
    candidateRefreshing: candidates.refreshing,
    candidate: {
      change: (nextSelectedId: string) => {
        if (candidates.selectCandidate(nextSelectedId))
          update(state.format, state.scope, nextSelectedId);
      },
      changePage: candidates.setPage,
      retryDirectory: candidates.retry,
      retrySelection: candidates.retrySelectedCandidate,
      scopeChanging: candidates.scopeChanging,
    },
    conditions: {
      changeFormat: (format: ExportFormat) => update(format, state.scope, selectedId),
      changeScope: (scope: ExportScope) => {
        candidates.reset();
        update(state.format, scope);
      },
      reset: () => {
        candidates.reset();
        update("csv", "all");
      },
    },
  };
}
