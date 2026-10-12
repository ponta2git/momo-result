import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import { queryClient as appQueryClient } from "@/app/queryClient";
import type { AuthMeResponse } from "@/shared/api/auth";
import {
  adminLoginAccountsQueryOptions,
  notificationSettingsQueryOptions,
} from "@/shared/api/queryOptions";
import { useAuthorization } from "@/shared/auth/useAuthorization";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

describe("useAuthorization protected reads", () => {
  it("coalesces simultaneous forbidden reads and does not restart them after unchanged auth", async () => {
    vi.stubEnv("DEV", false);
    const client = createTestQueryClient();
    const defaults = client.getDefaultOptions();
    client.setDefaultOptions({
      ...defaults,
      queries: {
        ...defaults.queries,
        retry: appQueryClient.getDefaultOptions().queries?.retry ?? false,
        retryDelay: 0,
      },
    });
    const rejectReads = createDeferred();
    const finishRecheck = createDeferred();
    const requests = { auth: 0, accounts: 0, notifications: 0 };
    const auth: AuthMeResponse = {
      accountId: "account_ponta",
      displayName: "ぽんた",
      role: "admin",
      csrfToken: "csrf-current",
    };
    const forbidden = {
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      code: "FORBIDDEN",
      detail: "Access was rejected",
    };
    server.use(
      http.get("/api/auth/me", async () => {
        requests.auth += 1;
        if (requests.auth > 1) await finishRecheck.promise;
        return HttpResponse.json(auth);
      }),
      http.get("/api/admin/login-accounts", async () => {
        requests.accounts += 1;
        await rejectReads.promise;
        return HttpResponse.json(forbidden, { status: 403 });
      }),
      http.get("/api/admin/notification-settings", async () => {
        requests.notifications += 1;
        await rejectReads.promise;
        return HttpResponse.json(forbidden, { status: 403 });
      }),
    );
    function Wrapper({ children }: PropsWithChildren) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result, rerender } = renderHook(
      () => {
        const authorization = useAuthorization();
        const accountOptions = adminLoginAccountsQueryOptions();
        const notificationOptions = notificationSettingsQueryOptions();
        const accounts = useQuery({
          ...accountOptions,
          enabled: authorization.canRead("admin", accountOptions.queryKey),
        });
        const notifications = useQuery({
          ...notificationOptions,
          enabled: authorization.canRead("admin", notificationOptions.queryKey),
        });
        return { authorization, accounts, notifications };
      },
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(requests).toEqual({ auth: 1, accounts: 1, notifications: 1 }));
    await act(async () => {
      rejectReads.resolve();
    });
    await waitFor(() => expect(requests.auth).toBe(2));
    expect(result.current.authorization.allowed.admin).toBe(false);
    expect(result.current.authorization.retained.admin).toBe(true);
    await act(async () => {
      finishRecheck.resolve();
    });
    await waitFor(() => {
      expect(result.current.authorization.allowed.admin).toBe(true);
      expect(result.current.accounts.status).toBe("error");
      expect(result.current.notifications.status).toBe("error");
    });
    const anotherConsumer = renderHook(() => useAuthorization(), { wrapper: Wrapper });
    await waitFor(() => expect(anotherConsumer.result.current.allowed.admin).toBe(true));

    await act(async () => {
      rerender();
      await client.invalidateQueries({ queryKey: ["admin"] });
    });
    expect(
      result.current.authorization.canRead("admin", adminLoginAccountsQueryOptions().queryKey),
    ).toBe(false);
    expect(
      result.current.authorization.canRead("admin", notificationSettingsQueryOptions().queryKey),
    ).toBe(false);
    expect(client.isFetching()).toBe(0);
    expect(requests).toEqual({ auth: 2, accounts: 1, notifications: 1 });
  });
});
