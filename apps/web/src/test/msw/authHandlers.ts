import { http, HttpResponse } from "msw";

import type { components } from "@/shared/api/generated";
import { mswState, now } from "@/test/msw/fixtures";
import type { LoginAccountRecord } from "@/test/msw/fixtures";

export const authHandlers = [
  http.get("/api/auth/me", ({ request }) => {
    const devUser = request.headers.get("X-Dev-User");
    if (!devUser) {
      return HttpResponse.json(
        {
          code: "UNAUTHORIZED",
          detail: "dev user is required",
          status: 401,
          title: "Unauthorized",
          type: "about:blank",
        },
        { status: 401 },
      );
    }
    const account = mswState.loginAccounts.find((item) => item.accountId === devUser);
    if (!account || !account.loginEnabled) {
      return HttpResponse.json(
        {
          code: "FORBIDDEN",
          detail: "dev user is not allowed",
          status: 403,
          title: "Forbidden",
          type: "about:blank",
        },
        { status: 403 },
      );
    }
    return HttpResponse.json({
      accountId: account.accountId,
      csrfToken: "dev",
      displayName: account.displayName,
      isAdmin: account.isAdmin,
      memberId: account.playerMemberId,
    });
  }),
  http.post("/api/auth/logout", () => new HttpResponse(null, { status: 204 })),
  http.get("/api/admin/login-accounts", () =>
    HttpResponse.json({ items: structuredClone(mswState.loginAccounts) }),
  ),
  http.post("/api/admin/login-accounts", async ({ request }) => {
    const body = (await request.json()) as components["schemas"]["CreateLoginAccountRequest"];
    const created: LoginAccountRecord = {
      accountId: `account-${body.discordUserId}`,
      createdAt: now,
      discordUserId: body.discordUserId,
      displayName: body.displayName,
      isAdmin: body.isAdmin,
      loginEnabled: body.loginEnabled,
      updatedAt: now,
    };
    if (body.playerMemberId) {
      created.playerMemberId = body.playerMemberId;
    }
    mswState.loginAccounts.push(created);
    return HttpResponse.json(created);
  }),
  http.patch("/api/admin/login-accounts/:accountId", async ({ params, request }) => {
    const accountId = String(params["accountId"]);
    const body = (await request.json()) as components["schemas"]["UpdateLoginAccountRequest"];
    mswState.loginAccounts = mswState.loginAccounts.map((account) =>
      account.accountId === accountId ? { ...account, ...body, updatedAt: now } : account,
    );
    const updated = mswState.loginAccounts.find((account) => account.accountId === accountId);
    return HttpResponse.json(updated);
  }),
];
