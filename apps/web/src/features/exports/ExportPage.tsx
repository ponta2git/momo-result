import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { listHeldEvents } from "@/features/draftReview/api";
import {
  DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
  DEFAULT_EXPORT_TIMEOUT_MS,
  downloadExportMatches,
} from "@/features/exports/exportDownload";
import type { ExportCandidate, ExportFormat, ExportScope } from "@/features/exports/exportTypes";
import {
  buildExportSearchParams,
  parseExportSearchParams,
  selectedIdForScope,
} from "@/features/exports/exportUrlState";
import {
  buildCandidateView,
  buildExportViewModel,
  failedResultView,
  formatDateTime,
} from "@/features/exports/exportViewModel";
import type { ExportDownloadResultView } from "@/features/exports/exportViewModel";
import { ExportWorkspace } from "@/features/exports/ExportWorkspace";
import { listMatches } from "@/features/matches/api";
import { listSeasonMasters } from "@/shared/api/masters";
import { shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { showToast } from "@/shared/ui/feedback/Toast";

type ExportPageProps = {
  downloadTimeoutMs?: number | undefined;
  slowThresholdMs?: number | undefined;
};

export function ExportPage({
  downloadTimeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
  slowThresholdMs = DEFAULT_EXPORT_SLOW_THRESHOLD_MS,
}: ExportPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = parseExportSearchParams(searchParams);
  const [lastResult, setLastResult] = useState<ExportDownloadResultView | undefined>();
  const [downloadStartedAt, setDownloadStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const seasonsQuery = useQuery({
    queryFn: () => listSeasonMasters(),
    queryKey: ["season-masters", "exports"],
  });
  const heldEventsQuery = useQuery({
    queryFn: () => listHeldEvents("", 100),
    queryKey: ["held-events", "exports"],
  });
  const matchesQuery = useQuery({
    queryFn: () => listMatches({ kind: "match", limit: 100, status: "confirmed" }),
    queryKey: ["matches", "exports", { kind: "match", status: "confirmed" }],
  });

  const seasonCandidates = useMemo<ExportCandidate[]>(
    () =>
      (seasonsQuery.data?.items ?? []).map((season) => ({
        label: season.name,
        value: season.id,
      })),
    [seasonsQuery.data],
  );
  const heldEventCandidates = useMemo<ExportCandidate[]>(
    () =>
      (heldEventsQuery.data?.items ?? []).map((event) => ({
        description: `${event.matchCount}試合`,
        label: formatDateTime(event.heldAt),
        value: event.id,
      })),
    [heldEventsQuery.data],
  );
  const matchCandidates = useMemo<ExportCandidate[]>(() => {
    const heldEventsById = new Map(
      (heldEventsQuery.data?.items ?? []).map((event) => [event.id, event]),
    );
    return (matchesQuery.data?.items ?? [])
      .filter((match) => match.kind === "match" && match.status === "confirmed" && match.matchId)
      .map((match) => {
        const heldAt = match.heldEventId
          ? heldEventsById.get(match.heldEventId)?.heldAt
          : undefined;
        return {
          description: match.seasonMasterId,
          label: `${heldAt ? formatDateTime(heldAt) : (match.heldEventId ?? "開催未設定")} / #${match.matchNoInEvent ?? "-"}`,
          value: match.matchId ?? "",
        };
      });
  }, [heldEventsQuery.data, matchesQuery.data]);

  const candidates =
    urlState.scope === "season"
      ? seasonCandidates
      : urlState.scope === "heldEvent"
        ? heldEventCandidates
        : urlState.scope === "match"
          ? matchCandidates
          : [];
  const candidateLoading =
    urlState.scope === "season"
      ? seasonsQuery.isLoading
      : urlState.scope === "heldEvent"
        ? heldEventsQuery.isLoading
        : urlState.scope === "match"
          ? matchesQuery.isLoading || heldEventsQuery.isLoading
          : false;
  const candidateError =
    urlState.scope === "season"
      ? shouldShowBlockingQueryError(seasonsQuery)
      : urlState.scope === "heldEvent"
        ? shouldShowBlockingQueryError(heldEventsQuery)
        : urlState.scope === "match"
          ? shouldShowBlockingQueryError(matchesQuery) ||
            shouldShowBlockingQueryError(heldEventsQuery)
          : false;

  const candidateView = buildCandidateView({
    candidates,
    error: candidateError,
    loading: candidateLoading,
    scope: urlState.scope,
    selectedId: selectedIdForScope(urlState, urlState.scope),
  });

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
        showToast({
          description: outcome.fileName,
          title: "ダウンロードを開始しました",
          tone: "success",
        });
        return;
      }
      if (outcome.kind === "timeout") {
        setLastResult({
          detail: outcome.detail,
          kind: "timeout",
          title: outcome.title,
        });
        showToast({ title: outcome.title, tone: "warning" });
        return;
      }
      const failed = failedResultView(outcome.error);
      setLastResult(failed);
      showToast({
        description: failed.detail,
        title: failed.title,
        tone: "danger",
      });
    },
  });

  const view = buildExportViewModel({
    candidate: candidateView,
    elapsedMs,
    isPending: mutation.isPending,
    lastResult,
    slowThresholdMs,
    urlState,
  });

  function updateSearch(format: ExportFormat, scope: ExportScope, selectedId?: string): void {
    setLastResult(undefined);
    setSearchParams(buildExportSearchParams({ format, scope, selectedId }), { replace: true });
  }

  return (
    <ExportWorkspace
      isPending={mutation.isPending}
      view={view}
      onCandidateChange={(selectedId) => updateSearch(urlState.format, urlState.scope, selectedId)}
      onDownload={() => mutation.mutate()}
      onFormatChange={(nextFormat) =>
        updateSearch(nextFormat, urlState.scope, selectedIdForScope(urlState, urlState.scope))
      }
      onScopeChange={(nextScope) => updateSearch(urlState.format, nextScope)}
    />
  );
}
