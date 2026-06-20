import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { AdminAccountsPage } from "@/features/adminAccounts/AdminAccountsPage";
import { adminAccountsQueryKeys } from "@/features/adminAccounts/queryKeys";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
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

  it("does not show a cached list error while refetching the account list", async () => {
    await queryClient
      .fetchQuery({
        queryKey: adminAccountsQueryKeys.all(),
        queryFn: async () => {
          throw new Error("cached account error");
        },
      })
      .catch(() => undefined);

    const requestStarted = createDeferred();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/admin/login-accounts", async () => {
        requestStarted.resolve();
        await responseGate.promise;
        return HttpResponse.json({
          items: [
            {
              accountId: "account-recovered",
              createdAt: "2026-01-01T00:00:00.000Z",
              discordUserId: "888000111222333444",
              displayName: "復旧ユーザー",
              isAdmin: false,
              loginEnabled: true,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }),
    );

    renderPage();

    await requestStarted.promise;
    expect(screen.queryByText("cached account error")).not.toBeInTheDocument();
    expect(screen.getByLabelText("ログインアカウントを読み込み中")).toBeInTheDocument();

    responseGate.resolve();
    expect(await screen.findByText("復旧ユーザー")).toBeInTheDocument();
  });
});
