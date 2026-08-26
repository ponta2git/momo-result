import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { GlobalNav } from "@/shared/ui/layout/GlobalNav";

describe("GlobalNav", () => {
  it("keeps short labels visible and every navigation target at least 44px square", () => {
    render(
      <MemoryRouter initialEntries={["/matches"]}>
        <GlobalNav authDisplayName="ぽんた" isAdmin />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "グローバルナビゲーション" })).toBeVisible();
    for (const name of ["試合", "戦績比較", "OCR", "開催", "出力", "分析", "設定", "アカウント"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveClass("min-h-11", "min-w-11");
      expect(within(link).getByText(name)).not.toHaveClass("sr-only");
    }
  });

  it("keeps the management group and its active destination discoverable", () => {
    render(
      <MemoryRouter initialEntries={["/admin/masters"]}>
        <GlobalNav authDisplayName="ぽんた" isAdmin />
      </MemoryRouter>,
    );

    const management = screen.getByRole("group", { name: "管理" });
    expect(within(management).getByText("管理")).toBeVisible();
    expect(within(management).getByRole("link", { name: "設定" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("replaces an unavailable logout action with an account-lock explanation", () => {
    render(
      <MemoryRouter initialEntries={["/matches"]}>
        <GlobalNav authDisplayName="ぽんた" isAccountLocked logoutFailed />
      </MemoryRouter>,
    );

    expect(screen.getByText("アカウント固定")).toBeVisible();
    expect(screen.queryByRole("button", { name: "ログアウト" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps logout failure feedback and its retry action at the account control", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(
      <MemoryRouter initialEntries={["/matches"]}>
        <GlobalNav authDisplayName="ぽんた" logoutFailed onLogout={onLogout} />
      </MemoryRouter>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("ログアウトできませんでした。");
    expect(alert).toHaveTextContent("ログイン状態と表示中の内容は保持しています。");
    expect(alert).toHaveTextContent("通信状態を確認して再試行してください。");
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    const retry = screen.getByRole("button", { name: "ログアウトを再試行" });
    expect(retry).toHaveAttribute("aria-describedby", alert.id);
    expect(retry).toHaveClass("bg-[var(--color-action)]");
    await user.click(retry);

    expect(onLogout).toHaveBeenCalledOnce();
  });
});
