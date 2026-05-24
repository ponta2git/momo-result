import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AdminAccountsPage } from "@/features/adminAccounts/AdminAccountsPage";
import { setupMsw } from "@/test/msw/lifecycle";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminAccountsPage />
    </QueryClientProvider>,
  );
}

describe("AdminAccountsPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("shows the created login account in the account list", async () => {
    renderPage();

    expect(await screen.findByText("ぽんた")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("例: 523484457705930752"), "999000111222333444");
    await user.type(screen.getByPlaceholderText("例: 代理入力者"), "監査ユーザー");
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(await screen.findByText("監査ユーザー")).toBeInTheDocument();
    expect(screen.getByText("999000111222333444")).toBeInTheDocument();
  });

  it("confirms login permission changes before applying them", async () => {
    renderPage();

    expect(await screen.findByText("523484457705930752")).toBeInTheDocument();
    await user.click((await screen.findAllByRole("button", { name: "ログイン停止" }))[0]!);

    expect(screen.getByRole("heading", { name: "ログインを停止しますか？" })).toBeInTheDocument();
    expect(screen.getByText(/変更後すぐに利用可否へ反映/u)).toBeInTheDocument();
    expect(screen.getByText("管理者 / 許可")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "停止する" }));

    await waitFor(() => expect(screen.getByText("管理者 / 停止")).toBeInTheDocument());
  });
});
