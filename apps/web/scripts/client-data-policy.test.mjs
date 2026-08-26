import assert from "node:assert/strict";
import test from "node:test";

import { findClientDataPolicyViolations } from "./client-data-policy.mjs";

test("accepts initial queries and user-driven refreshes", () => {
  const source = `
    const query = useQuery({ queryKey, queryFn });
    const refresh = () => query.refetch();
    const timer = window.setTimeout(showSlowFeedback, 500);
    const clock = window.setInterval(renderElapsedTime, 1_000);
    const defaults = {
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    };
  `;

  assert.deepEqual(findClientDataPolicyViolations(source), []);
});

test("rejects query intervals and periodic server refreshes", () => {
  const source = `
    useQuery({
      queryKey,
      queryFn,
      refetchInterval: 5_000,
      refetchIntervalInBackground: false,
    });
    window.setInterval(pollStatus, 5_000);
  `;

  assert.deepEqual(findClientDataPolicyViolations(source), [
    "source.ts: query intervals are forbidden; expose an explicit refresh action",
    "source.ts: periodic server refresh is forbidden; expose a user-triggered action",
  ]);
});

test("rejects activation and delayed automatic refreshes", () => {
  const source = `
    window.addEventListener("pageshow", () => query.refetch());
    window.setTimeout(() => fetch("/api/status"), 1_000);
    onlineManager.setOnline(true);
    const defaults = {
      refetchOnReconnect: true,
      refetchOnWindowFocus: () => "always",
    };
  `;

  assert.deepEqual(findClientDataPolicyViolations(source), [
    "source.ts: delayed server refresh is forbidden; keep timeouts presentation-only",
    "source.ts: TanStack focus/online managers must not trigger background server-state refresh",
    "source.ts: focus, visibility, pageshow, and reconnect events must not refresh server state",
    "source.ts: refetchOnReconnect must be configured as false",
    "source.ts: refetchOnWindowFocus must be configured as false",
  ]);
});
