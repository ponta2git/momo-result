// @vitest-environment node
import { focusManager, onlineManager, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { queryClient } from "@/app/queryClient";

describe("app queryClient", () => {
  it("keeps production cache and error defaults explicit", () => {
    expect(queryClient.getDefaultOptions()).toMatchObject({
      mutations: {
        retry: false,
      },
      queries: {
        retry: 1,
        throwOnError: false,
      },
    });
  });

  it("keeps stale results unchanged on focus and reconnect until the user refreshes", async () => {
    vi.useFakeTimers();
    let version = 0;
    let controlVersion = 0;
    const options = { queryKey: ["manual-refresh"], queryFn: async () => ++version };
    const controlOptions = {
      queryKey: ["automatic-refresh-control"],
      queryFn: async () => ++controlVersion,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    };
    queryClient.mount();
    await queryClient.fetchQuery(options);
    await queryClient.fetchQuery(controlOptions);
    const observer = new QueryObserver(queryClient, options);
    const control = new QueryObserver(queryClient, controlOptions);
    const unsubscribe = observer.subscribe(() => undefined);
    const unsubscribeControl = control.subscribe(() => undefined);

    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(observer.getCurrentResult().data).toBe(1);

      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(0);
      // The control proves that the signal reached mounted, stale observers.
      expect(control.getCurrentResult().data).toBe(2);
      expect(observer.getCurrentResult().data).toBe(1);

      await vi.advanceTimersByTimeAsync(60_000);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(control.getCurrentResult().data).toBe(3);
      expect(observer.getCurrentResult().data).toBe(1);

      expect((await observer.refetch()).data).toBe(2);
    } finally {
      unsubscribe();
      unsubscribeControl();
      queryClient.unmount();
      queryClient.clear();
      focusManager.setFocused(undefined);
      onlineManager.setOnline(true);
    }
  });
});
