import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { AuthMeResponse } from "@/shared/api/auth";
import { getCsrfToken } from "@/shared/api/csrfTokenStore";
import { matchKeys } from "@/shared/api/queryKeys";
import { authQueryOptions } from "@/shared/auth/authQueries";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

describe("auth principal transitions", () => {
  it("evicts previous account data and cancels its reads before publishing another account", async () => {
    vi.stubEnv("DEV", false);
    const client = createTestQueryClient();
    let accountId = "account-first";
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({
          accountId,
          csrfToken: `csrf-${accountId}`,
          displayName: accountId,
          role: "user",
        } satisfies AuthMeResponse),
      ),
    );
    await client.fetchQuery(authQueryOptions());
    const draftKey = matchKeys.draft.review("private-draft");
    client.setQueryData(draftKey, { privateText: "first account's OCR data" });
    window.sessionStorage.setItem("momoresult.private-draft", "first account's input");
    const lateResponse = createDeferred<string>();
    let oldSignal: AbortSignal | undefined;
    const oldRequest = client
      .fetchQuery({
        queryKey: matchKeys.draft.detail("late-private-draft"),
        queryFn: ({ signal }) => {
          oldSignal = signal;
          return lateResponse.promise;
        },
      })
      .catch(() => undefined);

    accountId = "account-second";
    await client.fetchQuery(authQueryOptions());

    expect(client.getQueryData(draftKey)).toBeUndefined();
    expect(oldSignal?.aborted).toBe(true);
    expect(window.sessionStorage.length).toBe(0);
    expect(getCsrfToken()).toBe("csrf-account-second");
    expect(client.getQueryData(authQueryOptions().queryKey)).toMatchObject({ accountId });
    lateResponse.resolve("old private response");
    await oldRequest;
    expect(client.getQueryData(matchKeys.draft.detail("late-private-draft"))).toBeUndefined();
  });
});
