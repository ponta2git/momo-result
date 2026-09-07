import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { AdminAccountsPage } from "@/features/adminAccounts/AdminAccountsPage";
import type { CreateLoginAccountRequest } from "@/shared/api/adminAccounts";
import { adminAccountKeys } from "@/shared/api/queryKeys";
import { createDeferred } from "@/test/deferred";
import { mswState } from "@/test/msw/fixtures";
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

  it("creates an account and shows its exact identity and permissions", async () => {
    renderPage();

    expect(
      await screen.findByRole("table", { name: "ログイン可能なアカウントと権限" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "ぽんた" })).toBeInTheDocument();
    const createTrigger = screen.getByRole("button", { name: "アカウントを追加" });
    await user.click(createTrigger);

    const dialog = screen.getByRole("dialog", { name: "アカウントを追加" });
    const playerSelect = within(dialog).getByRole("combobox", { name: "紐づくプレーヤー" });
    expect(playerSelect).toHaveValue("");

    const permissions = within(dialog).getByRole("group", { name: "権限" });
    const loginEnabled = within(permissions).getByRole("checkbox", { name: "ログイン許可" });
    const isAdmin = within(permissions).getByRole("checkbox", { name: "管理者" });
    expect(loginEnabled).toBeChecked();
    expect(isAdmin).not.toBeChecked();

    await user.type(
      within(dialog).getByPlaceholderText("例: 523484457705930752"),
      "999000111222333444",
    );
    await user.type(within(dialog).getByPlaceholderText("例: 代理入力者"), "監査ユーザー");
    await user.click(isAdmin);
    await user.click(within(dialog).getByRole("button", { name: "追加" }));

    const createdRow = (await screen.findByText("監査ユーザー")).closest("tr");
    expect(createdRow).not.toBeNull();
    expect(within(createdRow!).getByText("999000111222333444")).toBeInTheDocument();
    expect(within(createdRow!).getByText("管理者")).toBeInTheDocument();
    expect(within(createdRow!).getByText("ログイン許可")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "アカウントを追加" })).not.toBeInTheDocument(),
    );
  });

  it("retains every creation field after failure, retries unchanged, and resets after success", async () => {
    const submissions: Array<{ key: string | null; payload: CreateLoginAccountRequest }> = [];
    const failedResponse = createDeferred();
    server.use(
      http.post("/api/admin/login-accounts", async ({ request }) => {
        const payload = (await request.json()) as CreateLoginAccountRequest;
        submissions.push({ key: request.headers.get("Idempotency-Key"), payload });
        if (submissions.length === 1) {
          await failedResponse.promise;
          return HttpResponse.json({ detail: "temporarily unavailable" }, { status: 503 });
        }
        const created = {
          ...payload,
          accountId: "account-retry",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        mswState.loginAccounts.push(created);
        return HttpResponse.json(created);
      }),
    );
    renderPage();
    const trigger = await screen.findByRole("button", { name: "アカウントを追加" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "アカウントを追加" });
    const discordId = within(dialog).getByRole("textbox", { name: /DiscordユーザーID/u });
    const displayName = within(dialog).getByRole("textbox", { name: /表示名/u });
    const player = within(dialog).getByRole("combobox", { name: "紐づくプレーヤー" });
    const loginEnabled = within(dialog).getByRole("checkbox", { name: "ログイン許可" });
    const isAdmin = within(dialog).getByRole("checkbox", { name: "管理者" });
    await user.type(discordId, "999000111222333444");
    await user.type(displayName, "再送ユーザー");
    await user.selectOptions(player, "member_ponta");
    await user.click(loginEnabled);
    await user.click(isAdmin);
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    try {
      const submit = await within(dialog).findByRole("button", { name: "追加中" });
      expect(submit).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "キャンセル" })).toBeDisabled();
      await user.click(submit);
    } finally {
      failedResponse.resolve();
    }

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "アカウントを追加できません",
    );
    expect(submissions).toHaveLength(1);
    expect(discordId).toHaveValue("999000111222333444");
    expect(displayName).toHaveValue("再送ユーザー");
    expect(player).toHaveValue("member_ponta");
    expect(loginEnabled).not.toBeChecked();
    expect(isAdmin).toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(await screen.findByRole("rowheader", { name: "再送ユーザー" })).toBeVisible();
    expect(submissions).toHaveLength(2);
    expect(submissions[0]?.key).toMatch(/\S/u);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[1]?.payload).toEqual({
      discordUserId: "999000111222333444",
      displayName: "再送ユーザー",
      isAdmin: true,
      loginEnabled: false,
      playerMemberId: "member_ponta",
    });
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    const nextDialog = screen.getByRole("dialog", { name: "アカウントを追加" });
    expect(within(nextDialog).getByRole("textbox", { name: /DiscordユーザーID/u })).toHaveValue("");
    expect(within(nextDialog).getByRole("textbox", { name: /表示名/u })).toHaveValue("");
    expect(within(nextDialog).getByRole("combobox", { name: "紐づくプレーヤー" })).toHaveValue("");
    expect(within(nextDialog).getByRole("checkbox", { name: "ログイン許可" })).toBeChecked();
    expect(within(nextDialog).getByRole("checkbox", { name: "管理者" })).not.toBeChecked();
    expect(within(nextDialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("confirms login permission changes before applying them", async () => {
    let idempotencyKey: string | null = null;
    server.use(
      http.patch("/api/admin/login-accounts/:accountId", async ({ params, request }) => {
        idempotencyKey = request.headers.get("Idempotency-Key");
        const body = (await request.json()) as {
          isAdmin: boolean;
          loginEnabled: boolean;
        };
        const accountId = String(params["accountId"]);
        mswState.loginAccounts = mswState.loginAccounts.map((account) =>
          account.accountId === accountId
            ? { ...account, ...body, updatedAt: "2026-01-01T00:00:00.000Z" }
            : account,
        );
        return HttpResponse.json(
          mswState.loginAccounts.find((account) => account.accountId === accountId),
        );
      }),
    );
    renderPage();

    const accountRow = (await screen.findByText("523484457705930752")).closest("tr");
    expect(accountRow).not.toBeNull();
    await user.click((await screen.findAllByRole("button", { name: "ログイン停止" }))[0]!);

    expect(screen.getByRole("heading", { name: "ログインを停止しますか？" })).toBeInTheDocument();
    expect(screen.getByText(/変更後すぐに利用可否へ反映/u)).toBeInTheDocument();
    expect(within(accountRow!).getByText("管理者")).toBeInTheDocument();
    expect(within(accountRow!).getByText("ログイン許可")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "停止する" }));

    await waitFor(() => expect(within(accountRow!).getByText("ログイン停止")).toBeInTheDocument());
    expect(idempotencyKey).toMatch(/\S/u);
  });

  it("offers one account-creation action when the list is empty", async () => {
    server.use(http.get("/api/admin/login-accounts", () => HttpResponse.json({ items: [] })));

    renderPage();

    expect(
      await screen.findByRole("button", { name: "最初のアカウントを追加" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "アカウントを追加" })).not.toBeInTheDocument();
  });

  it("moves focus to the new header action after creating the first account", async () => {
    const accounts: Array<{
      accountId: string;
      createdAt: string;
      discordUserId: string;
      displayName: string;
      isAdmin: boolean;
      loginEnabled: boolean;
      updatedAt: string;
    }> = [];
    server.use(
      http.get("/api/admin/login-accounts", () => HttpResponse.json({ items: accounts })),
      http.post("/api/admin/login-accounts", async ({ request }) => {
        const body = (await request.json()) as {
          discordUserId: string;
          displayName: string;
          isAdmin: boolean;
          loginEnabled: boolean;
        };
        const created = {
          accountId: `account-${body.discordUserId}`,
          createdAt: "2026-01-01T00:00:00.000Z",
          ...body,
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        accounts.push(created);
        return HttpResponse.json(created);
      }),
    );

    renderPage();

    await user.click(await screen.findByRole("button", { name: "最初のアカウントを追加" }));
    const dialog = screen.getByRole("dialog", { name: "アカウントを追加" });
    await user.type(
      within(dialog).getByPlaceholderText("例: 523484457705930752"),
      "999000111222333444",
    );
    await user.type(within(dialog).getByPlaceholderText("例: 代理入力者"), "最初の利用者");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));

    expect(await screen.findByText("最初の利用者")).toBeInTheDocument();
    const nextCreateTrigger = await screen.findByRole("button", { name: "アカウントを追加" });
    await waitFor(() => expect(nextCreateTrigger).toHaveFocus());
  });

  it("does not show a cached list error while refetching the account list", async () => {
    await queryClient
      .fetchQuery({
        queryKey: adminAccountKeys.all(),
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

  it("separates a list failure from the empty state and offers retry", async () => {
    let attempts = 0;
    server.use(
      http.get("/api/admin/login-accounts", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({
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

    const retryButton = await screen.findByRole("button", {
      name: "アカウントを再読み込み",
    });
    expect(retryButton).toBeVisible();
    expect(screen.queryByText("ログイン可能なアカウントはまだありません")).not.toBeInTheDocument();

    await user.click(retryButton);

    expect(await screen.findByText("復旧ユーザー")).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("keeps cached empty data distinct from an initial failure and retries as a stale state", async () => {
    queryClient.setQueryData(adminAccountKeys.all(), { items: [] });
    let attempts = 0;
    server.use(
      http.get("/api/admin/login-accounts", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({
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

    expect(await screen.findByText("最新のアカウント情報を取得できません")).toBeInTheDocument();
    expect(
      screen.getByText("前回取得時点ではログイン可能なアカウントがありません"),
    ).toBeInTheDocument();
    expect(screen.queryByText("アカウントを読み込めません")).not.toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "最新情報を再読み込み" });
    expect(screen.getByRole("button", { name: "アカウントを追加" })).toBeEnabled();

    await user.click(retryButton);

    expect(await screen.findByText("復旧ユーザー")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("最新のアカウント情報を取得できません")).not.toBeInTheDocument(),
    );
    expect(attempts).toBe(2);
  });
});
