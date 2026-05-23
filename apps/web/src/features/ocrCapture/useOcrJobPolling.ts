import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { getOcrJob } from "@/features/ocrCapture/api";
import type { OcrJobResponse } from "@/features/ocrCapture/api";
import type { PollingPausedReason } from "@/features/ocrCapture/captureState";
import { ocrJobKeys } from "@/features/ocrCapture/queryKeys";
import { isTerminalJobStatus } from "@/shared/api/enums";
import type { NormalizedApiError } from "@/shared/api/problemDetails";

export const initialPollDelayMs = 4_000;
export const maxAutoPollElapsedMs = 300_000;
export const transientErrorPollIntervalMs = 30_000;
export const maxTransientPollingErrors = 3;

const jitterRangeMs = 700;
const minimumPollIntervalMs = 1_000;
const uint32Modulo = 4_294_967_296;

type UseOcrJobPollingInput = {
  jobId?: string | undefined;
  attempts: number;
  resetToken?: number | undefined;
};

export type OcrPollIntervalInput = {
  jobCreatedAtMs?: number | undefined;
  nowMs: number;
  runningFirstSeenAtMs?: number | undefined;
  status?: string | undefined;
  transientErrorCount?: number | undefined;
};

type OcrPollDecision = {
  intervalMs: number | false;
  pausedReason?: PollingPausedReason | undefined;
};

function elapsedSince(nowMs: number, startedAtMs: number | undefined): number {
  return Math.max(0, nowMs - (startedAtMs ?? nowMs));
}

export function getOcrPollDecision(input: OcrPollIntervalInput): OcrPollDecision {
  const transientErrorCount = input.transientErrorCount ?? 0;
  if (transientErrorCount >= maxTransientPollingErrors) {
    return { intervalMs: false, pausedReason: "transient_errors" };
  }
  if (transientErrorCount > 0) {
    return { intervalMs: transientErrorPollIntervalMs };
  }
  if (isTerminalJobStatus(input.status)) {
    return { intervalMs: false };
  }

  const jobElapsedMs = elapsedSince(input.nowMs, input.jobCreatedAtMs);
  if (jobElapsedMs >= maxAutoPollElapsedMs) {
    return { intervalMs: false, pausedReason: "timeout" };
  }

  if (input.status === "running") {
    const runningElapsedMs = elapsedSince(input.nowMs, input.runningFirstSeenAtMs);
    if (runningElapsedMs >= maxAutoPollElapsedMs) {
      return { intervalMs: false, pausedReason: "timeout" };
    }
    if (runningElapsedMs < 45_000) {
      return { intervalMs: 3_000 };
    }
    if (runningElapsedMs < 90_000) {
      return { intervalMs: 8_000 };
    }
    return { intervalMs: 20_000 };
  }

  if (jobElapsedMs < 45_000) {
    return { intervalMs: 5_000 };
  }
  if (jobElapsedMs < 120_000) {
    return { intervalMs: 12_000 };
  }
  return { intervalMs: 30_000 };
}

function stableJitterMs(seed: string): number {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % uint32Modulo;
  }
  return (hash % (jitterRangeMs + 1)) - Math.floor(jitterRangeMs / 2);
}

export function withOcrPollJitterMs(intervalMs: number, seed: string): number {
  return Math.max(minimumPollIntervalMs, intervalMs + stableJitterMs(seed));
}

export function getInitialOcrPollDelayMs(seed: string): number {
  return initialPollDelayMs + stableJitterMs(seed) + Math.floor(jitterRangeMs / 2);
}

function timestampFromJob(job: OcrJobResponse | undefined): number | undefined {
  if (!job) {
    return undefined;
  }
  const parsed = Date.parse(job.createdAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isTransientPollingError(error: unknown): error is NormalizedApiError {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as NormalizedApiError;
  return (
    candidate.status === 429 ||
    candidate.status === 503 ||
    candidate.code === "TOO_MANY_REQUESTS" ||
    candidate.code === "SERVICE_UNAVAILABLE"
  );
}

export function useOcrJobPolling({ jobId, attempts, resetToken }: UseOcrJobPollingInput) {
  const sessionStartedAtRef = useRef(Date.now());
  const resetTokenRef = useRef(resetToken);
  const [initialPollReady, setInitialPollReady] = useState(false);
  const [runningFirstSeenAtMs, setRunningFirstSeenAtMs] = useState<number | undefined>(undefined);
  const [transientErrorCount, setTransientErrorCount] = useState(0);
  const [pausedReason, setPausedReason] = useState<PollingPausedReason | undefined>(undefined);

  useEffect(() => {
    sessionStartedAtRef.current = Date.now();
    setInitialPollReady(false);
    setRunningFirstSeenAtMs(undefined);
    setTransientErrorCount(0);
    setPausedReason(undefined);

    if (!jobId) {
      return undefined;
    }

    const timer = setTimeout(() => setInitialPollReady(true), getInitialOcrPollDelayMs(jobId));
    return () => clearTimeout(timer);
  }, [jobId]);

  useEffect(() => {
    if (attempts === 0) {
      setTransientErrorCount(0);
      setPausedReason(undefined);
    }
  }, [attempts]);

  useEffect(() => {
    if (resetTokenRef.current === resetToken) {
      return;
    }
    resetTokenRef.current = resetToken;
    setTransientErrorCount(0);
    setPausedReason(undefined);
    if (jobId) {
      setInitialPollReady(true);
    }
  }, [jobId, resetToken]);

  const seed = jobId ?? "ocr-job";
  const query = useQuery({
    queryKey: ocrJobKeys.detail(jobId),
    queryFn: async () => {
      try {
        const job = await getOcrJob(jobId ?? "");
        setTransientErrorCount(0);
        return job;
      } catch (error) {
        setTransientErrorCount((current) => (isTransientPollingError(error) ? current + 1 : 0));
        throw error;
      }
    },
    enabled: Boolean(jobId) && initialPollReady && !pausedReason,
    refetchIntervalInBackground: false,
    refetchInterval: (currentQuery) => {
      if (!jobId) {
        return false;
      }
      const decision = getOcrPollDecision({
        jobCreatedAtMs: timestampFromJob(currentQuery.state.data) ?? sessionStartedAtRef.current,
        nowMs: Date.now(),
        runningFirstSeenAtMs,
        status: currentQuery.state.data?.status,
        transientErrorCount,
      });
      return decision.intervalMs === false ? false : withOcrPollJitterMs(decision.intervalMs, seed);
    },
    retry: false,
  });

  useEffect(() => {
    if (query.data?.status === "running" && runningFirstSeenAtMs === undefined) {
      setRunningFirstSeenAtMs(Date.now());
    }
  }, [query.data?.status, runningFirstSeenAtMs]);

  const nextDecision = useMemo(
    () =>
      getOcrPollDecision({
        jobCreatedAtMs: timestampFromJob(query.data) ?? sessionStartedAtRef.current,
        nowMs: Date.now(),
        runningFirstSeenAtMs,
        status: query.data?.status,
        transientErrorCount,
      }),
    [query.data, runningFirstSeenAtMs, transientErrorCount],
  );

  useEffect(() => {
    if (nextDecision.pausedReason) {
      setPausedReason(nextDecision.pausedReason);
    }
  }, [nextDecision.pausedReason]);

  return {
    ...query,
    pollingPausedReason: pausedReason ?? nextDecision.pausedReason,
    transientErrorCount,
  };
}
