import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedCallback } from "@/shared/lib/useDebouncedCallback";

afterEach(() => vi.useRealTimers());

describe("useDebouncedCallback", () => {
  it("runs only the latest value after quiet time, with the current callback", () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ callback }) => useDebouncedCallback(callback, 300), {
      initialProps: { callback: first },
    });
    act(() => result.current.schedule("first"));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.schedule("last"));
    rerender({ callback: second });
    act(() => vi.advanceTimersByTime(299));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(second).toHaveBeenCalledExactlyOnceWith("last");
  });

  it("cancels without requiring another valid value and cleans up on unmount", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 300));
    act(() => result.current.schedule(1));
    act(() => result.current.cancel());
    act(() => vi.advanceTimersByTime(300));
    expect(callback).not.toHaveBeenCalled();
    act(() => result.current.schedule(2));
    unmount();
    act(() => vi.advanceTimersByTime(300));
    expect(callback).not.toHaveBeenCalled();
  });
});
