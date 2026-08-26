import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppGlobalNav } from "@/app/AppGlobalNav";

const authMock = vi.hoisted(() => ({
  current: {
    auth: { displayName: "ぽんた", isAdmin: false },
    isLogoutPending: false,
    logout: vi.fn(),
    logoutError: undefined as { status: number } | undefined,
  },
}));

vi.mock("@/shared/auth/useAuth", () => ({
  useAuth: () => authMock.current,
}));

describe("AppGlobalNav", () => {
  beforeEach(() => {
    authMock.current = {
      auth: { displayName: "ぽんた", isAdmin: false },
      isLogoutPending: false,
      logout: vi.fn(),
      logoutError: undefined,
    };
  });

  it("owns the product route catalog and exposes admin destinations only to admins", () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={["/matches"]}>
        <AppGlobalNav />
      </MemoryRouter>,
    );

    for (const name of ["試合", "戦績比較", "OCR", "開催", "出力"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("group", { name: "管理" })).not.toBeInTheDocument();

    authMock.current = {
      ...authMock.current,
      auth: { displayName: "管理者", isAdmin: true },
    };
    rerender(
      <MemoryRouter initialEntries={["/matches"]}>
        <AppGlobalNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole("group", { name: "管理" })).toBeInTheDocument();
    for (const name of ["分析", "設定", "アカウント"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("keeps logout failure feedback and its retry action at the account control", async () => {
    const user = userEvent.setup();
    const logout = vi.fn();
    authMock.current = {
      auth: { displayName: "ぽんた", isAdmin: false },
      isLogoutPending: false,
      logout,
      logoutError: { status: 503 },
    };

    render(
      <MemoryRouter initialEntries={["/matches"]}>
        <AppGlobalNav />
      </MemoryRouter>,
    );

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
      render(
        <MemoryRouter initialEntries={["/matches"]}>
          <AppGlobalNav />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("button", { name: "ログアウト" })).not.toBeInTheDocument();
      expect(screen.queryByText("DEV")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
