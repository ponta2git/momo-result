import { useLayoutEffect, useRef, useState } from "react";

import { downloadExportMatches } from "@/features/exports/exportDownload";
import {
  buildExportDownloadResultView,
  buildExportDownloadFailureView,
} from "@/features/exports/exportPresentation";
import type { ExportDownloadResultView } from "@/features/exports/exportPresentation";
import type { ExportMatchesRequest } from "@/features/exports/exportTypes";
import { exportRequestIdentity } from "@/features/exports/exportUrlState";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";

export type ExportDownloadOptions = {
  readonly available: boolean;
  readonly request: Readonly<ExportMatchesRequest> | undefined;
  readonly slowThresholdMs: number;
  readonly timeoutMs: number;
};

export type ExportDownloadWorkflow = {
  readonly pending: boolean;
  readonly result: ExportDownloadResultView | undefined;
  readonly slow: boolean;
  readonly start: () => void;
};

type DownloadAttempt = {
  controller: AbortController;
  request: ExportMatchesRequest;
  requestIdentity: string;
  slowTimer: number | undefined;
};

type ExportDownloadState = {
  pending: boolean;
  result: ExportDownloadResultView | undefined;
  requestIdentity: string;
  slow: boolean;
};

function createIdleDownloadState(requestIdentity: string): ExportDownloadState {
  return { pending: false, result: undefined, requestIdentity, slow: false };
}

function clearSlowTimer(attempt: DownloadAttempt) {
  window.clearTimeout(attempt.slowTimer);
  attempt.slowTimer = undefined;
}

/** Download effects and progress belong to the selected request, including browser-history changes. */
export function useExportDownload({
  available,
  request,
  slowThresholdMs,
  timeoutMs,
}: ExportDownloadOptions): ExportDownloadWorkflow {
  const requestIdentity = exportRequestIdentity(request);
  const activeAttemptRef = useRef<DownloadAttempt | null>(null);
  const [downloadState, setDownloadState] = useState(() =>
    createIdleDownloadState(requestIdentity),
  );
  if (downloadState.requestIdentity !== requestIdentity)
    setDownloadState(createIdleDownloadState(requestIdentity));

  useLayoutEffect(
    () => () => {
      const attempt = activeAttemptRef.current;
      if (!attempt || attempt.requestIdentity !== requestIdentity) return;
      activeAttemptRef.current = null;
      clearSlowTimer(attempt);
      attempt.controller.abort();
    },
    [requestIdentity],
  );

  return {
    pending: downloadState.pending,
    result: downloadState.result,
    slow: downloadState.slow,
    start: () => {
      if (!available || !request || activeAttemptRef.current) return;
      const attempt: DownloadAttempt = {
        controller: new AbortController(),
        request,
        requestIdentity,
        slowTimer: undefined,
      };
      activeAttemptRef.current = attempt;
      setDownloadState((previous) => ({
        pending: true,
        result:
          previous.requestIdentity === requestIdentity && previous.result?.kind !== "success"
            ? previous.result
            : undefined,
        requestIdentity,
        slow: false,
      }));
      attempt.slowTimer = window.setTimeout(() => {
        attempt.slowTimer = undefined;
        if (activeAttemptRef.current === attempt) {
          setDownloadState((current) => ({ ...current, slow: true }));
        }
      }, slowThresholdMs);
      const finish = (result: ExportDownloadResultView | undefined) => {
        clearSlowTimer(attempt);
        if (activeAttemptRef.current !== attempt) return;
        activeAttemptRef.current = null;
        setDownloadState({
          pending: false,
          result,
          requestIdentity: attempt.requestIdentity,
          slow: false,
        });
      };
      void downloadExportMatches(attempt.request, {
        signal: attempt.controller.signal,
        timeoutMs,
      }).then(
        (outcome) => finish(buildExportDownloadResultView(outcome)),
        (error: unknown) => finish(buildExportDownloadFailureView(normalizeUnknownApiError(error))),
      );
    },
  };
}
