import { describe, expect, it } from "vitest";

import {
  getInitialOcrPollDelayMs,
  getOcrPollDecision,
  maxTransientPollingErrors,
  transientErrorPollIntervalMs,
  withOcrPollJitterMs,
} from "@/features/ocrCapture/useOcrJobPolling";

describe("getOcrPollDecision", () => {
  const startedAt = Date.UTC(2026, 0, 1, 0, 0, 0);

  it("uses sparse intervals while the job is still queued", () => {
    expect(
      getOcrPollDecision({
        jobCreatedAtMs: startedAt,
        nowMs: startedAt + 20_000,
        status: "queued",
      }).intervalMs,
    ).toBe(5_000);
    expect(
      getOcrPollDecision({
        jobCreatedAtMs: startedAt,
        nowMs: startedAt + 60_000,
        status: "queued",
      }).intervalMs,
    ).toBe(12_000);
    expect(
      getOcrPollDecision({
        jobCreatedAtMs: startedAt,
        nowMs: startedAt + 180_000,
        status: "queued",
      }).intervalMs,
    ).toBe(30_000);
  });

  it("polls running jobs closely only in the expected completion window", () => {
    const runningAt = startedAt + 10_000;
    expect(
      getOcrPollDecision({
        jobCreatedAtMs: startedAt,
        nowMs: runningAt + 20_000,
        runningFirstSeenAtMs: runningAt,
        status: "running",
      }).intervalMs,
    ).toBe(3_000);
    expect(
      getOcrPollDecision({
        jobCreatedAtMs: startedAt,
        nowMs: runningAt + 60_000,
        runningFirstSeenAtMs: runningAt,
        status: "running",
      }).intervalMs,
    ).toBe(8_000);
    expect(
      getOcrPollDecision({
        jobCreatedAtMs: startedAt,
        nowMs: runningAt + 120_000,
        runningFirstSeenAtMs: runningAt,
        status: "running",
      }).intervalMs,
    ).toBe(20_000);
  });

  it("stops for terminal jobs, stale jobs, and repeated transient failures", () => {
    expect(
      getOcrPollDecision({
        jobCreatedAtMs: startedAt,
        nowMs: startedAt + 10_000,
        status: "succeeded",
      }).intervalMs,
    ).toBe(false);
    expect(
      getOcrPollDecision({
        jobCreatedAtMs: startedAt,
        nowMs: startedAt + 300_000,
        status: "queued",
      }),
    ).toEqual({ intervalMs: false, pausedReason: "timeout" });
    expect(
      getOcrPollDecision({
        jobCreatedAtMs: startedAt,
        nowMs: startedAt + 10_000,
        status: "running",
        transientErrorCount: maxTransientPollingErrors,
      }),
    ).toEqual({ intervalMs: false, pausedReason: "transient_errors" });
  });

  it("backs off transient failures before pausing", () => {
    expect(
      getOcrPollDecision({
        jobCreatedAtMs: startedAt,
        nowMs: startedAt + 10_000,
        status: "running",
        transientErrorCount: 1,
      }).intervalMs,
    ).toBe(transientErrorPollIntervalMs);
  });
});

describe("OCR poll jitter", () => {
  it("is stable per job and keeps intervals positive", () => {
    expect(withOcrPollJitterMs(3_000, "job-a")).toBe(withOcrPollJitterMs(3_000, "job-a"));
    expect(withOcrPollJitterMs(3_000, "job-a")).not.toBe(withOcrPollJitterMs(3_000, "job-b"));
    expect(withOcrPollJitterMs(1, "job-a")).toBeGreaterThanOrEqual(1_000);
  });

  it("delays the first poll by at least the base initial delay", () => {
    expect(getInitialOcrPollDelayMs("job-a")).toBeGreaterThanOrEqual(4_000);
  });
});
