import { waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient as appQueryClient } from "@/app/queryClient";
import { cacheSavedAccount } from "@/features/masters/accounts/adminAccountCache";
import { updateLoginAccount } from "@/shared/api/adminAccounts";
import type { LoginAccountResponse } from "@/shared/api/adminAccounts";
import { getAuthMe } from "@/shared/api/auth";
import type { AuthMeResponse } from "@/shared/api/auth";
import { getCsrfToken, setCsrfToken } from "@/shared/api/csrfTokenStore";
import type { NotificationSettings } from "@/shared/api/notificationSettings";
import {
  adminLoginAccountsQueryOptions,
  gameTitlesQueryOptions,
  notificationSettingsQueryOptions,
} from "@/shared/api/queryOptions";
import {
  seriesAnalysisAdminOverviewQueryOptions,
  seriesAnalysisAggregateQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import {
  seriesAnalysisScopeStatusQueryOptions,
  seriesPlayerRadarStateQueryOptions,
} from "@/shared/api/seriesPlayerRadar";
import { getAuthorization } from "@/shared/auth/authorization";
import { authMeQueryKeyFor, authQueryOptions } from "@/shared/auth/authQueries";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import { analysisArtifact } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function authResponse(
  role: AuthMeResponse["role"] = "admin",
  csrfToken = "csrf-current",
): AuthMeResponse {
  return {
    accountId: "account_ponta",
    csrfToken,
    displayName: "ぽんた",
    memberId: "member_ponta",
    role,
  };
}

function accountResponse(displayName = "現在の表示名"): LoginAccountResponse {
  return {
    accountId: "account_ponta",
    createdAt: "2026-10-01T00:00:00.000Z",
    discordUserId: "123456789012345678",
    displayName,
    loginEnabled: true,
    playerMemberId: "member_ponta",
    role: "admin",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function failure(status: 401 | 403 | 503) {
  return {
    code:
      status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "TEMPORARILY_UNAVAILABLE",
    detail: "request unavailable",
    status,
    title: "Request unavailable",
    type: "about:blank",
  };
}

function createProductionRetryClient() {
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
  return client;
}

describe("authorization", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", false);
    const settings = {
      analysisCompleted: { enabled: true, generation: "2" },
      ocrCompleted: { enabled: false, generation: "1" },
    } satisfies NotificationSettings;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(authResponse())),
      http.get("/api/admin/notification-settings", () => HttpResponse.json(settings)),
    );
  });

  it.each([
    [401, 1],
    [403, 1],
    [503, 2],
  ] as const)("uses production retry policy for HTTP %s", async (status, expectedRequests) => {
    const client = createProductionRetryClient();
    const requests = { auth: 0, accounts: 0 };
    server.use(
      http.get("/api/auth/me", () => {
        requests.auth += 1;
        return HttpResponse.json(failure(status), { status });
      }),
      http.get("/api/admin/login-accounts", () => {
        requests.accounts += 1;
        return HttpResponse.json(failure(status), { status });
      }),
    );

    await expect(client.fetchQuery(authQueryOptions())).rejects.toMatchObject({ status });
    await expect(client.fetchQuery(adminLoginAccountsQueryOptions())).rejects.toMatchObject({
      status,
    });

    expect(requests).toEqual({ auth: expectedRequests, accounts: expectedRequests });
  });

  it("removes only data for lost permissions while keeping public data and session CSRF", async () => {
    const client = createProductionRetryClient();
    let role: AuthMeResponse["role"] = "admin";
    server.use(http.get("/api/auth/me", () => HttpResponse.json(authResponse(role))));
    await client.fetchQuery(authQueryOptions());
    const authorization = getAuthorization(client);
    const accounts = adminLoginAccountsQueryOptions();
    const notifications = notificationSettingsQueryOptions();
    const overview = seriesAnalysisAdminOverviewQueryOptions(analysisArtifact.gameTitleId);
    const radar = seriesPlayerRadarStateQueryOptions(analysisArtifact.gameTitleId);
    const masters = gameTitlesQueryOptions();
    const artifact = seriesAnalysisAggregateQueryOptions({
      artifactId: analysisArtifact.artifactId,
      gameTitleId: analysisArtifact.gameTitleId,
    });
    const scope = seriesAnalysisScopeStatusQueryOptions({
      gameTitleId: analysisArtifact.gameTitleId,
    });
    const [, , overviewData, radarData, masterData, artifactData, scopeData] = await Promise.all([
      client.fetchQuery(accounts),
      client.fetchQuery(notifications),
      client.fetchQuery(overview),
      client.fetchQuery(radar),
      client.fetchQuery(masters),
      client.fetchQuery(artifact),
      client.fetchQuery(scope),
    ]);

    role = "operator";
    await authorization.recheck();
    await waitFor(() => {
      expect(client.getQueryData(accounts.queryKey)).toBeUndefined();
      expect(client.getQueryData(notifications.queryKey)).toBeUndefined();
    });
    expect(client.getQueryData(overview.queryKey)).toBe(overviewData);
    expect(client.getQueryData(radar.queryKey)).toBe(radarData);
    expect(authorization.can("admin")).toBe(false);
    expect(authorization.can("operations")).toBe(true);

    role = "user";
    await authorization.recheck();
    await waitFor(() => {
      expect(client.getQueryData(overview.queryKey)).toBeUndefined();
      expect(client.getQueryData(radar.queryKey)).toBeUndefined();
    });
    expect(client.getQueryData(masters.queryKey)).toBe(masterData);
    expect(client.getQueryData(artifact.queryKey)).toBe(artifactData);
    expect(client.getQueryData(scope.queryKey)).toBe(scopeData);
    expect(getCsrfToken()).toBe("csrf-current");
  });

  it("does not revive an old admin completion after an admin/operator/admin transition", async () => {
    const client = createProductionRetryClient();
    let role: AuthMeResponse["role"] = "admin";
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(authResponse(role))),
      http.get("/api/admin/login-accounts", () =>
        HttpResponse.json({ items: [accountResponse()] }),
      ),
    );
    await client.fetchQuery(authQueryOptions());
    const authorization = getAuthorization(client);
    const oldAdmin = authorization.begin("admin");
    const ongoingOperation = authorization.begin("operations");
    if (!oldAdmin || !ongoingOperation) throw new Error("initial permissions were not available");
    const accounts = adminLoginAccountsQueryOptions();
    await client.fetchQuery(accounts);

    role = "operator";
    await authorization.recheck();
    await waitFor(() => expect(client.getQueryData(accounts.queryKey)).toBeUndefined());
    role = "admin";
    await authorization.recheck();
    const currentAccounts = await client.fetchQuery(accounts);
    const newAdmin = authorization.begin("admin");
    if (!newAdmin) throw new Error("admin access was not restored");

    await cacheSavedAccount(client, accountResponse("古い応答の表示名"), () =>
      authorization.canCommit(oldAdmin),
    );

    expect(authorization.isCurrent(oldAdmin)).toBe(false);
    expect(authorization.canCommit(oldAdmin)).toBe(false);
    expect(authorization.canCommit(newAdmin)).toBe(true);
    expect(authorization.canCommit(ongoingOperation)).toBe(true);
    expect(client.getQueryData(accounts.queryKey)).toBe(currentAccounts);
    expect(client.getQueryData(accounts.queryKey)?.items?.[0]?.displayName).toBe("現在の表示名");
  });

  it("reconciles a delayed self-demotion without overriding a newer auth response", async () => {
    const client = createProductionRetryClient();
    const updateStarted = createDeferred();
    const finishUpdate = createDeferred();
    let csrf = "csrf-original";
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(authResponse("admin", csrf))),
      http.patch("/api/admin/login-accounts/account_ponta", async () => {
        updateStarted.resolve();
        await finishUpdate.promise;
        return HttpResponse.json({ ...accountResponse(), role: "operator" });
      }),
    );
    await client.fetchQuery(authQueryOptions());
    const authorization = getAuthorization(client);
    const lease = authorization.begin("admin");
    if (!lease) throw new Error("initial admin access was not available");
    const pending = updateLoginAccount(
      "account_ponta",
      { role: "operator" },
      { idempotencyKey: "old-self-demotion" },
    );
    await updateStarted.promise;

    csrf = "csrf-newer";
    await authorization.recheck();
    const newAdmin = authorization.begin("admin");
    if (!newAdmin) throw new Error("newer admin access was not available");
    finishUpdate.resolve();
    const saved = await pending;
    await authorization.acceptSelfRole(lease, saved.role);

    expect(client.getQueryData(authMeQueryKeyFor(undefined))).toMatchObject({
      role: "admin",
      csrfToken: "csrf-newer",
    });
    expect(authorization.canCommit(newAdmin)).toBe(true);
    expect(getCsrfToken()).toBe("csrf-newer");
  });

  it.each([200, 403] as const)(
    "ignores an aborted auth body with status %s after a newer session response",
    async (status) => {
      const client = createProductionRetryClient();
      const oldBody = createDeferred<unknown>();
      const readingOldBody = createDeferred();
      const oldResponse = new Response(null, {
        status,
        headers: { "Content-Type": "application/json" },
      });
      vi.spyOn(oldResponse, "json").mockImplementation(() => {
        readingOldBody.resolve();
        return oldBody.promise;
      });
      // The fetch already delivered its headers; cancellation races with decoding its body.
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(oldResponse)
        .mockResolvedValueOnce(HttpResponse.json(authResponse("admin", "csrf-newer")));
      setCsrfToken("csrf-original");
      const controller = new AbortController();
      const oldRequest = getAuthMe({ signal: controller.signal }).catch((error: unknown) => error);
      await readingOldBody.promise;
      controller.abort();
      await client.fetchQuery(authQueryOptions());

      oldBody.resolve(status === 200 ? authResponse("user", "csrf-old") : failure(403));
      const oldError = await oldRequest;

      expect(oldError).toMatchObject(status === 200 ? { name: "AbortError" } : { status: 403 });
      expect(getCsrfToken()).toBe("csrf-newer");
      expect(client.getQueryData(authMeQueryKeyFor(undefined))).toMatchObject({
        role: "admin",
        csrfToken: "csrf-newer",
      });
    },
  );
});
