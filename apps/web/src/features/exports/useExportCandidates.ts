import { useState } from "react";

import { resolveExportCandidate } from "@/features/exports/exportCandidateData";
import {
  buildCandidateSupportIssue,
  buildCandidateView,
} from "@/features/exports/exportPresentation";
import type { ExportCandidate, ExportScope } from "@/features/exports/exportTypes";
import { useExportCandidateResource } from "@/features/exports/useExportCandidateResource";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Retains the selected candidate while its directory moves between pages or retries. */
export function useExportCandidates({
  scope,
  selectedId,
}: {
  scope: ExportScope;
  selectedId: string;
}) {
  const [heldEventPage, setHeldEventPage] = useState(1);
  const [matchCursor, setMatchCursor] = useState("");
  const [selectionSnapshot, setSelectionSnapshot] = useState<{
    candidate: ExportCandidate;
    scope: ExportScope;
  } | null>(null);
  const resource = useExportCandidateResource({ scope, selectedId, heldEventPage, matchCursor });
  const { directory, target } = resource;
  const snapshotCandidate =
    selectionSnapshot?.scope === scope && selectionSnapshot.candidate.value === selectedId
      ? selectionSnapshot.candidate
      : undefined;
  const selected =
    scope === "season"
      ? {
          candidate: target.onCurrentPage,
          state:
            selectedId && !target.onCurrentPage ? ("not-found" as const) : ("resolved" as const),
        }
      : resolveExportCandidate({
          canonicalCandidate: target.candidate,
          detailFailure: target.failure,
          detailFetching: target.refreshing,
          selectedId,
          shouldResolve: target.requiresLookup,
          snapshotCandidate,
        });
  const resolvedCandidate = selected.candidate;
  const retrySelectionFailed = useRetryNotice(
    selected.state === "load-failed",
    target.refreshing,
    scope + ":" + selectedId,
  );
  const selectedResolution =
    selected.state === "resolving" && retrySelectionFailed ? "load-failed" : selected.state;
  const hasResolvedTarget = Boolean(selectedId && resolvedCandidate?.value === selectedId);
  const loading = directory.activity === "loading" && (scope === "season" || !hasResolvedTarget);
  const refreshing =
    directory.activity === "refreshing" ||
    (directory.activity === "loading" && scope !== "season" && hasResolvedTarget);
  const selectedDetailRefreshFailed =
    target.failure === "load-failed" && resolvedCandidate?.value === selectedId;
  const error = directory.failed && !directory.hasCurrentData && !hasResolvedTarget;
  const supportIssue = buildCandidateSupportIssue({
    directoryBlocking: error,
    directoryError: directory.failed,
    hasCurrentDirectoryData: directory.hasCurrentData,
    selectedTargetRefreshFailed: selectedDetailRefreshFailed,
  });
  const view = buildCandidateView({
    candidates:
      target.failure === "not-found"
        ? directory.candidates.filter((candidate) => candidate.value !== selectedId)
        : directory.candidates,
    error,
    loading: loading && !error,
    pagination: directory.pagination,
    resolvedCandidate,
    selectedResolution,
    scope,
    selectedId,
    supportIssue,
  });
  const reset = () => {
    setHeldEventPage(1);
    setMatchCursor("");
    setSelectionSnapshot(null);
  };
  const rememberCurrentSelection = () => {
    if (resolvedCandidate?.value === selectedId) {
      setSelectionSnapshot({ candidate: resolvedCandidate, scope });
    }
  };
  return {
    refreshing:
      refreshing ||
      (loading && error) ||
      (target.refreshing && selectedResolution === "load-failed"),
    reset,
    scopeChanging: directory.scopeChanging,
    selectCandidate: (nextSelectedId: string) => {
      if (refreshing) return false;
      const candidate = directory.candidates.find((item) => item.value === nextSelectedId);
      if (candidate) setSelectionSnapshot({ candidate, scope });
      return true;
    },
    setPage: (page: number) => {
      if (refreshing || page < 1) return;
      rememberCurrentSelection();
      if (scope === "heldEvent") setHeldEventPage(page);
      if (scope === "match") {
        const cursor = resource.matchCursorForPage(page);
        if (cursor !== undefined) setMatchCursor(cursor);
      }
    },
    retry: () => {
      rememberCurrentSelection();
      resource.refreshDirectory();
    },
    retrySelectedCandidate: resource.refreshSelection,
    view,
  };
}
