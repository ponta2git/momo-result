import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { downloadExportMatches } from "@/features/exports/exportDownload";
import type { ExportDownloadOutcome, ExportMatchesRequest } from "@/features/exports/exportTypes";
import { failedResultView } from "@/features/exports/exportViewModel";
import type { ExportDownloadResultView } from "@/features/exports/exportViewModel";

type ExportDownloadOptions = {
  slowThresholdMs: number;
  timeoutMs: number;
};

export type ExportDownloadWorkflow = {
  clearResult: () => void;
  pending: boolean;
  result: ExportDownloadResultView | undefined;
  slow: boolean;
  start: (request: ExportMatchesRequest) => void;
};

function toResultView(outcome: ExportDownloadOutcome): ExportDownloadResultView {
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

/** Owns one export download's request lifecycle, progress timing, and user-facing result. */
export function useExportDownload({
  slowThresholdMs,
  timeoutMs,
}: ExportDownloadOptions): ExportDownloadWorkflow {
  const [result, setResult] = useState<ExportDownloadResultView | undefined>();
  const [slow, setSlow] = useState(false);
  const slowTimerRef = useRef<number | undefined>(undefined);

  const clearSlowTimer = useCallback(() => {
    if (slowTimerRef.current === undefined) return;
    window.clearTimeout(slowTimerRef.current);
    slowTimerRef.current = undefined;
  }, []);

  useEffect(() => clearSlowTimer, [clearSlowTimer]);

  const mutation = useMutation({
    mutationFn: (request: ExportMatchesRequest) => downloadExportMatches(request, { timeoutMs }),
    onMutate: () => {
      clearSlowTimer();
      setSlow(false);
      setResult(undefined);
      slowTimerRef.current = window.setTimeout(() => {
        slowTimerRef.current = undefined;
        setSlow(true);
      }, slowThresholdMs);
    },
    onSettled: () => {
      clearSlowTimer();
      setSlow(false);
    },
    onSuccess: (outcome) => {
      setResult(toResultView(outcome));
    },
  });

  return {
    clearResult: () => setResult(undefined),
    pending: mutation.isPending,
    result,
    slow,
    start: (request) => mutation.mutate(request),
  };
}
