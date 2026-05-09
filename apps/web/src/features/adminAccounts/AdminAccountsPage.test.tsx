import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AdminAccountsPage } from "@/features/adminAccounts/AdminAccountsPage";
import { createTestQueryClient } from "@/test/queryClient";

let queryClient: QueryClient;

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
  });

  it("shows the created login account in the account list", async () => {
    renderPage();

    expect(await screen.findByText("ぽんた")).toBeInTheDocument();

    await userEvent.type(
      screen.getByPlaceholderText("例: 523484457705930752"),
      "999000111222333444",
    );
    await userEvent.type(screen.getByPlaceholderText("例: 代理入力者"), "監査ユーザー");
    await userEvent.click(screen.getByRole("button", { name: "追加" }));

    expect(await screen.findByText("監査ユーザー")).toBeInTheDocument();
    expect(screen.getByText("999000111222333444")).toBeInTheDocument();
  });
});
