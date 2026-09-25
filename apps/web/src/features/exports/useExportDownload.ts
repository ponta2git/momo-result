import { useMutation } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";

import { downloadExportMatches } from "@/features/exports/exportDownload";
import type { ExportDownloadOutcome, ExportMatchesRequest } from "@/features/exports/exportTypes";
import { failedResultView } from "@/features/exports/exportViewModel";
import type { ExportDownloadResultView } from "@/features/exports/exportViewModel";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";

type ExportDownloadOptions = {
  request: ExportMatchesRequest | undefined;
  slowThresholdMs: number;
  timeoutMs: number;
};

export type ExportDownloadWorkflow = {
  pending: boolean;
  result: ExportDownloadResultView | undefined;
  slow: boolean;
  start: () => void;
};

type DownloadAttempt = {
  controller: AbortController;
  request: ExportMatchesRequest;
  scope: string;
  slowTimer: number | undefined;
};

type DownloadPresentation = {
  pending: boolean;
  result: ExportDownloadResultView | undefined;
  scope: string;
  slow: boolean;
};

function emptyPresentation(scope: string): DownloadPresentation {
  return { pending: false, result: undefined, scope, slow: false };
}

function clearSlowTimer(attempt: DownloadAttempt) {
  window.clearTimeout(attempt.slowTimer);
  attempt.slowTimer = undefined;
}

function toResultView(outcome: ExportDownloadOutcome): ExportDownloadResultView | undefined {
  if (outcome.kind === "cancelled") return undefined;
  if (outcome.kind === "download_started") {
    return {
      fileName: outcome.fileName,
      format: outcome.format,
      kind: "success",
      startedAt: outcome.startedAt,
    };
  }
  if (outcome.kind === "timeout") {
    return {
      detail: outcome.detail,
      kind: "timeout",
      title: outcome.title,
    };
  }
  return failedResultView(outcome.error);
}

/** Download effects and progress belong to the selected request, including browser-history changes. */
export function useExportDownload({
  request,
  slowThresholdMs,
  timeoutMs,
}: ExportDownloadOptions): ExportDownloadWorkflow {
  const scope = request
    ? JSON.stringify([
        request.format,
        request.scope,
        request.heldEventId,
        request.matchId,
        request.seasonMasterId,
      ])
    : "invalid";
  const activeAttemptRef = useRef<DownloadAttempt | null>(null);
  const [presentation, setPresentation] = useState(() => emptyPresentation(scope));
  if (presentation.scope !== scope) setPresentation(emptyPresentation(scope));

  useLayoutEffect(
    () => () => {
      const attempt = activeAttemptRef.current;
      if (!attempt || attempt.scope !== scope) return;
      activeAttemptRef.current = null;
      clearSlowTimer(attempt);
      attempt.controller.abort();
    },
    [scope],
  );

  const mutation = useMutation({
    mutationFn: (attempt: DownloadAttempt) =>
      downloadExportMatches(attempt.request, {
        signal: attempt.controller.signal,
        timeoutMs,
      }),
    onSettled: (outcome, error, attempt) => {
      clearSlowTimer(attempt);
      if (activeAttemptRef.current !== attempt) return;
      activeAttemptRef.current = null;
      setPresentation({
        pending: false,
        result: outcome ? toResultView(outcome) : failedResultView(normalizeUnknownApiError(error)),
        scope: attempt.scope,
        slow: false,
      });
    },
  });

  return {
    pending: presentation.pending,
    result: presentation.result,
    slow: presentation.slow,
    start: () => {
      if (!request || activeAttemptRef.current) return;
      const attempt: DownloadAttempt = {
        controller: new AbortController(),
        request,
        scope,
        slowTimer: undefined,
      };
      activeAttemptRef.current = attempt;
      setPresentation((previous) => ({
        pending: true,
        result:
          previous.scope === scope && previous.result?.kind !== "success"
            ? previous.result
            : undefined,
        scope,
        slow: false,
      }));
      attempt.slowTimer = window.setTimeout(() => {
        attempt.slowTimer = undefined;
        if (activeAttemptRef.current === attempt) {
          setPresentation((current) => ({ ...current, slow: true }));
        }
      }, slowThresholdMs);
      mutation.mutate(attempt);
    },
  };
}
