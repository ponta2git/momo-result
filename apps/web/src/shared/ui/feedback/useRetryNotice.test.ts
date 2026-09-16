import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useRetryNotice } from "@/shared/ui/feedback/useRetryNotice";

describe("useRetryNotice", () => {
  it("keeps recovery available through a retry, clears on success and never carries across scopes", () => {
    const { result, rerender } = renderHook(
      ({ failed, pending, scope }) => useRetryNotice(failed, pending, scope),
      { initialProps: { failed: true, pending: false, scope: "first" } },
    );
    rerender({ failed: false, pending: true, scope: "first" });
    expect(result.current).toBe(true);
    rerender({ failed: false, pending: false, scope: "first" });
    expect(result.current).toBe(false);
    rerender({ failed: true, pending: false, scope: "first" });
    rerender({ failed: false, pending: true, scope: "second" });
    expect(result.current).toBe(false);
  });
});
