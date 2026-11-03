import { focusManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  completionCheckIntervalMs,
  completionCheckLimitMs,
  completionCheckOptions,
} from "@/shared/api/completionCheck";

type Read = { wait: string | undefined };

/** Serves the given reads in order and repeats the last one; a thrown entry fails that read. */
function observe(reads: ReadonlyArray<Read | Error>) {
  let served = 0;
  // Matches the app client: focus alone never refetches, so only the check's own rechecks count.
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  });
  const observer = new QueryObserver(client, {
    queryKey: ["completion-check"],
    queryFn: async () => {
      const read = reads[Math.min(served, reads.length - 1)];
      served += 1;
      if (read instanceof Error) throw read;
      return read;
    },
    ...completionCheckOptions((read: Read) => read.wait),
  });
  const unsubscribe = observer.subscribe(() => undefined);
  return {
    observer,
    reads: () => served,
    stop: () => {
      unsubscribe();
      client.clear();
    },
  };
}

describe("completion check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  it("rechecks only while the read shows a wait, and stops once the work ends", async () => {
    const check = observe([{ wait: "job-1" }, { wait: "job-1" }, { wait: undefined }]);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(check.reads()).toBe(1);
      await vi.advanceTimersByTimeAsync(completionCheckIntervalMs * 2);
      expect(check.reads()).toBe(3);
      expect(check.observer.getCurrentResult().data).toEqual({ wait: undefined });

      await vi.advanceTimersByTimeAsync(completionCheckIntervalMs * 10);
      expect(check.reads()).toBe(3);
    } finally {
      check.stop();
    }
  });

  it("leaves a read with nothing waiting to the screen's own update", async () => {
    const check = observe([{ wait: undefined }]);
    try {
      await vi.advanceTimersByTimeAsync(completionCheckLimitMs);
      expect(check.reads()).toBe(1);
    } finally {
      check.stop();
    }
  });

  it("stops after a failed read until an explicit update succeeds", async () => {
    const check = observe([{ wait: "job-1" }, new Error("unavailable"), { wait: "job-1" }]);
    try {
      await vi.advanceTimersByTimeAsync(completionCheckIntervalMs);
      expect(check.reads()).toBe(2);
      await vi.advanceTimersByTimeAsync(completionCheckIntervalMs * 10);
      expect(check.reads()).toBe(2);

      await check.observer.refetch();
      await vi.advanceTimersByTimeAsync(completionCheckIntervalMs);
      expect(check.reads()).toBe(4);
    } finally {
      check.stop();
    }
  });

  it("gives up on a wait that outlasts the limit, and starts over for a different wait", async () => {
    const reads: Read[] = [{ wait: "job-1" }];
    const check = observe(reads);
    try {
      await vi.advanceTimersByTimeAsync(completionCheckLimitMs + completionCheckIntervalMs);
      const readsAtLimit = check.reads();
      expect(readsAtLimit).toBeGreaterThan(1);
      await vi.advanceTimersByTimeAsync(completionCheckIntervalMs * 10);
      expect(check.reads()).toBe(readsAtLimit);

      // The same wait stays stopped after an explicit update; a new wait gets its own window.
      await check.observer.refetch();
      await vi.advanceTimersByTimeAsync(completionCheckIntervalMs * 3);
      expect(check.reads()).toBe(readsAtLimit + 1);
      reads.push({ wait: "job-2" });
      await check.observer.refetch();
      await vi.advanceTimersByTimeAsync(completionCheckIntervalMs);
      expect(check.reads()).toBe(readsAtLimit + 3);
    } finally {
      check.stop();
    }
  });

  it("skips rechecks while the page is hidden", async () => {
    const check = observe([{ wait: "job-1" }]);
    try {
      await vi.advanceTimersByTimeAsync(0);
      focusManager.setFocused(false);
      await vi.advanceTimersByTimeAsync(completionCheckIntervalMs * 5);
      expect(check.reads()).toBe(1);

      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(completionCheckIntervalMs);
      expect(check.reads()).toBe(2);
    } finally {
      check.stop();
    }
  });
});
