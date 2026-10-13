import { onlineManager, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { runIdempotentMutation } from "@/shared/api/idempotency";
import { replaceMatchNote } from "@/shared/api/matches";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { clearPrincipalClientState } from "@/shared/auth/principalClientState";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

describe("principal-bound commands", () => {
  it("refuses an offline queued write after switching accounts while permitting the new account's write", async () => {
    setDevUser("account-first");
    const client = createTestQueryClient();
    const writes: Array<{ account: string | null; body: unknown }> = [];
    server.use(
      http.put("/api/matches/match-1/note", async ({ request }) => {
        writes.push({
          account: request.headers.get("X-Momo-Account-Id"),
          body: await request.json(),
        });
        return HttpResponse.json({ matchId: "match-1", version: "1" });
      }),
    );
    const mountEditor = () =>
      renderHook(
        () => {
          const keys = useIdempotencyKeyStore();
          return useMutation({
            mutationFn: (body: string) =>
              runIdempotentMutation(keys, "matchDetail.replaceMatchNote", body, (options) =>
                replaceMatchNote("match-1", { body, expectedVersion: "0" }, options),
              ),
          });
        },
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
          ),
        },
      );
    const first = mountEditor();
    try {
      onlineManager.setOnline(false);
      act(() => first.result.current.mutate("previous account's private input"));
      await waitFor(() => expect(first.result.current.isPaused).toBe(true));

      await act(async () => clearPrincipalClientState(client));
      setDevUser("account-second");
      act(() => onlineManager.setOnline(true));
      await waitFor(() => expect(first.result.current.isError).toBe(true));
      expect(writes).toEqual([]);

      first.unmount();
      const second = mountEditor();
      await act(async () => {
        await second.result.current.mutateAsync("new account's note");
      });
      expect(writes).toEqual([
        {
          account: "account-second",
          body: { body: "new account's note", expectedVersion: "0" },
        },
      ]);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
