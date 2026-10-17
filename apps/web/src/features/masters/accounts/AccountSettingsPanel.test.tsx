import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { AccountSettingsPanel } from "@/features/masters/accounts/AccountSettingsPanel";
import { useAccountSettings } from "@/features/masters/accounts/useAccountSettings";
import type {
  CreateLoginAccountRequest,
  UpdateLoginAccountRequest,
} from "@/shared/api/adminAccounts";
import { adminAccountKeys } from "@/shared/api/queryKeys";
import { getAuthorization } from "@/shared/auth/authorizationQueryAdapter";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { mswState } from "@/test/msw/fixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();

let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;

function AccountSettingsHarness() {
  const settings = useAccountSettings();
  return <AccountSettingsPanel settings={settings} />;
}

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountSettingsHarness />
    </QueryClientProvider>,
  );
}

describe("AccountSettingsPanel", () => {
  beforeEach(() => {
    setDevUser();
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it.each([
    ["user", "一般"],
    ["operator", "運用担当"],
    ["admin", "管理者"],
  ])("creates a %s account with its exact identity and permissions", async (role, label) => {
    renderPage();

    expect(
      await screen.findByRole("table", { name: "登録アカウントとログイン・ロール" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "ぽんた" })).toBeInTheDocument();
    const createTrigger = screen.getByRole("button", { name: "アカウントを追加" });
    await user.click(createTrigger);

    const dialog = screen.getByRole("dialog", { name: "アカウントを追加" });
    const playerSelect = within(dialog).getByRole("combobox", { name: "紐づくプレーヤー" });
    expect(playerSelect).toHaveTextContent("試合参加者に紐づけない");

    const permissions = within(dialog).getByRole("group", { name: "権限" });
    const loginEnabled = within(permissions).getByRole("checkbox", { name: "ログイン許可" });
    const roleSelect = within(permissions).getByRole("combobox", { name: /ロール/u });
    expect(loginEnabled).toBeChecked();
    expect(roleSelect).toHaveTextContent("一般");

    await user.type(
      within(dialog).getByPlaceholderText("例: 523484457705930752"),
      "999000111222333444",
    );
    await user.type(within(dialog).getByPlaceholderText("例: 代理入力者"), "監査ユーザー");
    await selectOption(user, roleSelect, role);
    await user.click(within(dialog).getByRole("button", { name: "追加" }));

    const createdRow = (await screen.findByText("監査ユーザー")).closest("tr");
    expect(createdRow).not.toBeNull();
    expect(within(createdRow!).getByText("999000111222333444")).toBeInTheDocument();
    expect(within(createdRow!).getByText(label)).toBeInTheDocument();
    expect(within(createdRow!).getByText("ログイン許可")).toBeInTheDocument();
    expect(
      mswState.loginAccounts.find((account) => account.discordUserId === "999000111222333444"),
    ).toMatchObject({ role, loginEnabled: true });
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
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "アカウントを追加" });
    const discordId = within(dialog).getByRole("textbox", { name: /DiscordユーザーID/u });
    const displayName = within(dialog).getByRole("textbox", { name: /表示名/u });
    const player = within(dialog).getByRole("combobox", { name: "紐づくプレーヤー" });
    const loginEnabled = within(dialog).getByRole("checkbox", { name: "ログイン許可" });
    const roleSelect = within(dialog).getByRole("combobox", { name: /ロール/u });
    await user.type(discordId, "999000111222333444");
    await user.type(displayName, "再送ユーザー");
    await selectOption(user, player, "member_ponta");
    await user.click(loginEnabled);
    await selectOption(user, roleSelect, "operator");
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
    expect(player).toHaveTextContent("ぽんた");
    expect(loginEnabled).not.toBeChecked();
    expect(roleSelect).toHaveTextContent("運用担当");

    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(await screen.findByRole("rowheader", { name: "再送ユーザー" })).toBeVisible();
    expect(submissions).toHaveLength(2);
    expect(submissions[0]?.key).toMatch(/\S/u);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[1]?.payload).toEqual({
      discordUserId: "999000111222333444",
      displayName: "再送ユーザー",
      role: "operator",
      loginEnabled: false,
      playerMemberId: "member_ponta",
    });
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    const nextDialog = screen.getByRole("dialog", { name: "アカウントを追加" });
    expect(within(nextDialog).getByRole("textbox", { name: /DiscordユーザーID/u })).toHaveValue("");
    expect(within(nextDialog).getByRole("textbox", { name: /表示名/u })).toHaveValue("");
    expect(
      within(nextDialog).getByRole("combobox", { name: "紐づくプレーヤー" }),
    ).toHaveTextContent("試合参加者に紐づけない");
    expect(within(nextDialog).getByRole("checkbox", { name: "ログイン許可" })).toBeChecked();
    expect(within(nextDialog).getByRole("combobox", { name: /ロール/u })).toHaveTextContent("一般");
    expect(within(nextDialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks duplicate new submissions while an obsolete creation waits across demotion and regrant", async () => {
    const oldResponse = createDeferred();
    const newResponse = createDeferred();
    const submissions: Array<{ key: string | null; payload: CreateLoginAccountRequest }> = [];
    server.use(
      http.post("/api/admin/login-accounts", async ({ request }) => {
        const payload = (await request.json()) as CreateLoginAccountRequest;
        submissions.push({ key: request.headers.get("Idempotency-Key"), payload });
        await (submissions.length === 1 ? oldResponse : newResponse).promise;
        const created = {
          ...payload,
          accountId: `account-${payload.discordUserId}`,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        mswState.loginAccounts.push(created);
        return HttpResponse.json(created);
      }),
    );
    renderPage();
    const trigger = await screen.findByRole("button", { name: "アカウントを追加" });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    const oldDialog = screen.getByRole("dialog", { name: "アカウントを追加" });
    await user.type(
      within(oldDialog).getByRole("textbox", { name: /DiscordユーザーID/u }),
      "999000111222333444",
    );
    await user.type(within(oldDialog).getByRole("textbox", { name: /表示名/u }), "以前の追加");
    await user.click(within(oldDialog).getByRole("button", { name: "追加" }));
    await waitFor(() => expect(submissions).toHaveLength(1));

    const account = mswState.loginAccounts.find((entry) => entry.accountId === "account_ponta")!;
    account.role = "operator";
    await act(() => getAuthorization(queryClient, "account_ponta").recheck());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "アカウントを追加" })).not.toBeInTheDocument(),
    );
    account.role = "admin";
    await act(() => getAuthorization(queryClient, "account_ponta").recheck());
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    const newDialog = screen.getByRole("dialog", { name: "アカウントを追加" });
    await user.type(
      within(newDialog).getByRole("textbox", { name: /DiscordユーザーID/u }),
      "999000111222333445",
    );
    await user.type(within(newDialog).getByRole("textbox", { name: /表示名/u }), "新しい追加");
    await selectOption(
      user,
      within(newDialog).getByRole("combobox", { name: "ロール" }),
      "operator",
    );
    try {
      await user.dblClick(within(newDialog).getByRole("button", { name: "追加" }));
      expect(within(newDialog).getByRole("button", { name: "追加中" })).toBeDisabled();
      expect(submissions).toHaveLength(1);

      await act(async () => oldResponse.resolve());
      await waitFor(() => expect(submissions).toHaveLength(2));
      expect(within(newDialog).getByRole("button", { name: "追加中" })).toBeDisabled();
      expect(within(newDialog).getByRole("textbox", { name: /表示名/u })).toHaveValue("新しい追加");
      await user.click(within(newDialog).getByRole("button", { name: "追加中" }));
    } finally {
      oldResponse.resolve();
      newResponse.resolve();
    }
    expect(await screen.findByRole("rowheader", { name: "新しい追加" })).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "アカウントを追加" })).not.toBeInTheDocument(),
    );
    expect(submissions).toHaveLength(2);
    expect(submissions[1]?.key).toMatch(/\S/u);
    expect(submissions[1]?.payload).toEqual({
      discordUserId: "999000111222333445",
      displayName: "新しい追加",
      role: "operator",
      loginEnabled: true,
    });
  });

  it("confirms login permission changes before applying them", async () => {
    let idempotencyKey: string | null = null;
    server.use(
      http.patch("/api/admin/login-accounts/:accountId", async ({ params, request }) => {
        idempotencyKey = request.headers.get("Idempotency-Key");
        const body = (await request.json()) as UpdateLoginAccountRequest;
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

    const accountRow = (await screen.findByText("523484457705930755")).closest("tr");
    expect(accountRow).not.toBeNull();
    await user.click(within(accountRow!).getByRole("button", { name: "ログイン停止" }));

    expect(screen.getByRole("heading", { name: "ログインを停止しますか？" })).toBeInTheDocument();
    expect(screen.getByText(/変更後すぐに利用可否へ反映/u)).toBeInTheDocument();
    expect(within(accountRow!).getByText("一般")).toBeInTheDocument();
    expect(within(accountRow!).getByText("ログイン許可")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "停止する" }));

    await waitFor(() => expect(within(accountRow!).getByText("ログイン停止")).toBeInTheDocument());
    expect(idempotencyKey).toMatch(/\S/u);
  });

  it("shows permissions only after the update is confirmed and retains them through a failed list refresh", async () => {
    const response = createDeferred();
    let saved = false;
    server.use(
      http.get("/api/admin/login-accounts", () =>
        saved
          ? HttpResponse.json({ detail: "unavailable" }, { status: 503 })
          : HttpResponse.json({ items: mswState.loginAccounts }),
      ),
      http.patch("/api/admin/login-accounts/account_eu", async ({ request }) => {
        const patch = (await request.json()) as UpdateLoginAccountRequest;
        await response.promise;
        saved = true;
        return HttpResponse.json({ ...mswState.loginAccounts[1], ...patch });
      }),
    );
    renderPage();
    const row = (await screen.findByRole("rowheader", { name: "いーゆー" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "ロール変更" }));
    const dialog = screen.getByRole("alertdialog", { name: "ロールを変更しますか？" });
    expect(within(dialog).getByRole("button", { name: "変更する" })).toBeDisabled();
    await selectOption(user, within(dialog).getByRole("combobox", { name: "ロール" }), "admin");
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    expect(within(row).getByText("一般")).toBeInTheDocument();
    expect(within(row).queryByText("管理者")).not.toBeInTheDocument();
    expect(await within(dialog).findByRole("button", { name: "更新中…" })).toBeDisabled();
    response.resolve();

    expect(await screen.findByText("最新のアカウント情報を取得できません")).toBeInTheDocument();
    expect(within(row).getByText("管理者")).toBeInTheDocument();
    expect(within(row).queryByText("一般")).not.toBeInTheDocument();
    expect(await within(row).findByRole("button", { name: "ロール変更" })).toBeEnabled();
  });

  it("retains the selected role after a last-admin rejection without changing the saved role", async () => {
    const submissions: UpdateLoginAccountRequest[] = [];
    server.use(
      http.patch("/api/admin/login-accounts/account_ponta", async ({ request }) => {
        submissions.push((await request.json()) as UpdateLoginAccountRequest);
        return HttpResponse.json(
          {
            code: "LAST_ENABLED_ADMIN_REQUIRED",
            detail: "At least one enabled administrator account is required.",
            status: 409,
            title: "Conflict",
            type: "about:blank",
          },
          { status: 409 },
        );
      }),
    );
    renderPage();
    const row = (await screen.findByRole("rowheader", { name: "ぽんた" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "ロール変更" }));
    const dialog = screen.getByRole("alertdialog", { name: "ロールを変更しますか？" });
    const roleSelect = within(dialog).getByRole("combobox", { name: "ロール" });
    await selectOption(user, roleSelect, "operator");
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "ログイン可能な管理者を1人以上残してください。",
    );
    expect(roleSelect).toHaveTextContent("運用担当");
    expect(within(row).getByText("管理者")).toBeInTheDocument();
    expect(submissions).toEqual([{ role: "operator" }]);
    expect(
      mswState.loginAccounts.find((account) => account.accountId === "account_ponta")?.role,
    ).toBe("admin");

    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await user.click(within(row).getByRole("button", { name: "ロール変更" }));
    const reopened = screen.getByRole("alertdialog", { name: "ロールを変更しますか？" });
    expect(within(reopened).getByRole("combobox", { name: "ロール" })).toHaveTextContent("管理者");
    expect(within(reopened).getByRole("button", { name: "変更する" })).toBeDisabled();
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
              role: "user",
              loginEnabled: true,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }),
    );

    renderPage();

    try {
      await act(async () => {
        await requestStarted.promise;
      });
      expect(await screen.findByLabelText("アカウントを読み込み中")).toBeInTheDocument();
      expect(screen.queryByText("cached account error")).not.toBeInTheDocument();
    } finally {
      await act(async () => responseGate.resolve());
    }
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
                  role: "user",
                  loginEnabled: true,
                  updatedAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            });
      }),
    );

    renderPage();

    const retryButton = await screen.findByRole("button", {
      name: "再読み込み",
    });
    expect(retryButton).toBeVisible();
    expect(screen.queryByText("登録されたアカウントはありません")).not.toBeInTheDocument();

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
                  role: "user",
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
      screen.getByText("前回取得時点では登録されたアカウントがありません"),
    ).toBeInTheDocument();
    expect(screen.queryByText("アカウントを読み込めません")).not.toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "再読み込み" });
    expect(screen.getByRole("button", { name: "アカウントを追加" })).toBeEnabled();

    await user.click(retryButton);

    expect(await screen.findByText("復旧ユーザー")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("最新のアカウント情報を取得できません")).not.toBeInTheDocument(),
    );
    expect(attempts).toBe(2);
  });
});
