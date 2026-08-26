import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearCsrfToken, getCsrfToken } from "@/shared/api/csrfTokenStore";
import { useAuth } from "@/shared/auth/useAuth";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function AuthHarness() {
  const auth = useAuth();

  return (
    <div>
      <p>{auth.auth?.displayName ?? (auth.isUnauthorized ? "ログアウト済み" : "確認中")}</p>
      <button type="button" onClick={auth.logout}>
        ログアウト
      </button>
      {auth.logoutError ? <p role="alert">ログアウト失敗</p> : null}
    </div>
  );
}

function renderAuth() {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AuthHarness />
    </QueryClientProvider>,
  );
}

describe("useAuth logout session cleanup", () => {
  afterEach(() => {
    clearCsrfToken();
    vi.unstubAllEnvs();
  });

  it("clears the previous session CSRF token when logout reports 401", async () => {
    vi.stubEnv("DEV", false);
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({
          accountId: "account_ponta",
          csrfToken: "session-csrf",
          displayName: "ぽんた",
          isAdmin: true,
          memberId: "member_ponta",
        }),
      ),
      http.post("/api/auth/logout", () =>
        HttpResponse.json(
          {
            code: "UNAUTHORIZED",
            detail: "session ended",
            status: 401,
            title: "Unauthorized",
            type: "about:blank",
          },
          { status: 401 },
        ),
      ),
    );
    renderAuth();

    expect(await screen.findByText("ぽんた")).toBeInTheDocument();
    expect(getCsrfToken()).toBe("session-csrf");

    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));

    expect(await screen.findByText("ログアウト済み")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getCsrfToken()).toBeUndefined();
  });

  it("keeps the current session CSRF token when logout fails with 503", async () => {
    vi.stubEnv("DEV", false);
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({
          accountId: "account_ponta",
          csrfToken: "session-csrf",
          displayName: "ぽんた",
          isAdmin: true,
          memberId: "member_ponta",
        }),
      ),
      http.post("/api/auth/logout", () =>
        HttpResponse.json(
          {
            code: "TEMPORARILY_UNAVAILABLE",
            detail: "logout temporarily unavailable",
            status: 503,
            title: "Temporary failure",
            type: "about:blank",
          },
          { status: 503 },
        ),
      ),
    );
    renderAuth();

    expect(await screen.findByText("ぽんた")).toBeInTheDocument();
    expect(getCsrfToken()).toBe("session-csrf");

    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ログアウト失敗"));
    expect(screen.getByText("ぽんた")).toBeInTheDocument();
    expect(getCsrfToken()).toBe("session-csrf");
  });
});
