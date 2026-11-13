import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, matchRoutes, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppGlobalNav } from "@/app/AppGlobalNav";
import { appRoutes } from "@/app/router";

const authMock = vi.hoisted(() => ({
  current: {
    auth: { displayName: "ぽんた", role: "user" },
    isAuthenticated: true,
    isLogoutPending: false,
    logout: vi.fn(),
    logoutError: undefined as { status: number } | undefined,
  },
}));

vi.mock("@/shared/auth/useAuthSession", () => ({
  useAuthSession: () => authMock.current,
}));

/** Renders the navigation under the metadata the real route table declares for the entry. */
function renderNav(entry = "/matches") {
  const handle: unknown = matchRoutes(appRoutes, entry)?.at(-1)?.route.handle;
  const router = createMemoryRouter([{ path: "*", element: <AppGlobalNav />, handle }], {
    initialEntries: [entry],
  });
  const view = render(<RouterProvider router={router} />);
  // The mocked session is read on render, so a promotion is shown by rendering the tree again.
  return { rerender: () => view.rerender(<RouterProvider key="again" router={router} />) };
}

describe("AppGlobalNav", () => {
  beforeEach(() => {
    authMock.current = {
      auth: { displayName: "ぽんた", role: "user" },
      isAuthenticated: true,
      isLogoutPending: false,
      logout: vi.fn(),
      logoutError: undefined,
    };
  });

  it.each(["/ocr/new?heldEventId=held-1", "/review/session-1", "/matches/new", "/drafts"])(
    "marks 記録する while %s records a match, and opens the newest held event from it",
    (entry) => {
      renderNav(entry);
      const record = screen.getByRole("link", { name: "記録する" });
      expect(record).toHaveAttribute("aria-current", "page");
      expect(record).toHaveAttribute("href", "/");
      // Entering a match sits under /matches, but it is not browsing confirmed matches.
      for (const name of ["開催", "試合", "戦績比較", "実績"]) {
        expect(screen.getByRole("link", { name })).not.toHaveAttribute("aria-current");
      }
    },
  );

  it.each([
    ["/matches/match-1/edit", "試合"],
    ["/m/12", "試合"],
    ["/exports?heldEventId=held-1", "試合"],
    ["/e/3", "開催"],
    ["/held-events/held-1", "開催"],
  ])("places %s under %s", (entry, area) => {
    renderNav(entry);
    expect(screen.getByRole("link", { name: area })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "記録する" })).not.toHaveAttribute("aria-current");
  });

  it("keeps management destinations hidden from a user and shows them after promotion", () => {
    const role = "user";
    authMock.current = { ...authMock.current, auth: { displayName: "利用者", role } };
    const { rerender } = renderNav("/matches");

    // Destinations are the recorded objects and the views across them; ways of recording live
    // inside 記録する, and 出力 opens from the records it carries out.
    expect(
      screen
        .getAllByRole("link")
        .map((link) => link.textContent)
        .filter((label) => label !== "momo-result"),
    ).toEqual(["記録する", "開催", "試合", "戦績比較", "実績"]);
    expect(screen.queryByRole("group", { name: "管理" })).not.toBeInTheDocument();

    authMock.current = {
      ...authMock.current,
      auth: { displayName: "管理者", role: "admin" },
    };
    rerender();

    expect(screen.getByRole("group", { name: "管理" })).toBeInTheDocument();
    for (const name of ["分析", "設定"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: "通知" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "アカウント" })).not.toBeInTheDocument();
  });

  it("shows analysis and settings to an operator", () => {
    authMock.current.auth.role = "operator";
    renderNav();
    expect(screen.getByRole("link", { name: "分析" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定" })).toBeInTheDocument();
  });

  it("keeps logout failure feedback and its retry action at the account control", async () => {
    const user = userEvent.setup();
    const logout = vi.fn();
    authMock.current = {
      auth: { displayName: "ぽんた", role: "user" },
      isAuthenticated: true,
      isLogoutPending: false,
      logout,
      logoutError: { status: 503 },
    };

    renderNav("/matches");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("ログアウトできませんでした。");
    expect(alert).toHaveTextContent("ログイン状態と表示中の内容は保持しています。");
    const retry = screen.getByRole("button", { name: "ログアウトを再試行" });
    expect(retry).toHaveAttribute("aria-describedby", alert.id);
    await user.click(retry);
    expect(logout).toHaveBeenCalledOnce();
  });

  it("keeps logout out of the commercial navigation", () => {
    vi.stubEnv("DEV", false);
    try {
      renderNav("/matches");

      expect(screen.queryByRole("button", { name: "ログアウト" })).not.toBeInTheDocument();
      expect(screen.queryByText("DEV")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
