import { QueryClientProvider, QueryErrorResetBoundary } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { MastersPage } from "@/features/masters/MastersPage";
import type { GameTitleResponse } from "@/shared/api/masters";
import { masterKeys } from "@/shared/api/queryKeys";
import { authQueryOptions } from "@/shared/auth/authQueries";
import {
  createMatchWorkspaceMasterHandoffPayload,
  saveMasterHandoff,
} from "@/shared/workflows/matchWorkspaceMasterHandoff";
import { setDevUser, testDevUserAccountId } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeMatchWorkspaceMasterHandoffValues } from "@/test/factories";
import { mswState } from "@/test/msw/fixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;

function renderPage(entry = "/admin/masters") {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <MastersPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderRoutedPage(entry: string) {
  const router = createMemoryRouter(
    [
      { path: "/admin/masters", element: <MastersPage /> },
      { path: "/matches", element: <h1>試合へ移動しました</h1> },
    ],
    { initialEntries: ["/matches", entry] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function openGameTitleCreateDialog() {
  await user.click(screen.getByRole("button", { name: "作品を追加" }));
  return screen.findByRole("dialog", { name: "作品を追加" });
}

function createMasterReturnEntry() {
  const returnTo = "/review/session-1?totalAssets=draft-1";
  const handoffId = saveMasterHandoff(
    createMatchWorkspaceMasterHandoffPayload({
      accountId: testDevUserAccountId,
      matchSessionId: "session-1",
      returnTo,
      values: makeMatchWorkspaceMasterHandoffValues({
        draftIds: { totalAssets: "draft-1" },
        gameTitleId: "gt_momotetsu_2",
        heldEventId: "event-1",
        mapMasterId: "map_east",
        matchNoInEvent: 1,
        ownerMemberId: "member_ponta",
        playedAt: "2026-01-01T00:00:00.000Z",
        seasonMasterId: "season_current",
      }),
    }),
  );

  return `/admin/masters?returnTo=${encodeURIComponent(returnTo)}&handoffId=${handoffId}`;
}

describe("MastersPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("exposes the master categories through one labeled tab set", async () => {
    setDevUser();
    renderPage();

    expect(await screen.findByRole("region", { name: "設定管理" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "設定管理の表示切替" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "作品" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "マップ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "シーズン" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "事件簿" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "通知" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "アカウント" })).toBeInTheDocument();
  });

  it("explains an unknown settings tab and repairs only that URL condition", async () => {
    setDevUser();
    renderPage("/admin/masters?tab=unknown&returnTo=%2Fmatches");
    expect(await screen.findByText("指定された設定項目が見つかりません")).toBeVisible();
    expect(screen.getByRole("tab", { name: "作品・マップ・シーズン" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "設定項目をリセット" }));
    expect(screen.queryByText("指定された設定項目が見つかりません")).not.toBeInTheDocument();
    expect(screen.getByLabelText("current location")).toHaveTextContent(
      "/admin/masters?returnTo=%2Fmatches",
    );
  });

  it("retains unsaved notification choices across tabs and asks before leaving the page", async () => {
    setDevUser();
    server.use(
      http.get("/api/admin/notification-settings", () =>
        HttpResponse.json({
          ocrCompleted: { enabled: true, generation: "0" },
          analysisCompleted: { enabled: true, generation: "0" },
        }),
      ),
    );
    const router = renderRoutedPage("/admin/masters?tab=notifications");
    const ocr = await screen.findByRole("checkbox", { name: "OCR完了" });
    expect(ocr).toBeChecked();
    await user.click(ocr);
    await user.click(screen.getByRole("tab", { name: "事件簿" }));
    expect(await screen.findByRole("heading", { name: "事件簿" })).toBeVisible();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "通知" }));
    expect(screen.getByRole("checkbox", { name: "OCR完了" })).not.toBeChecked();
    await act(async () => {
      await router.navigate("/matches");
    });
    expect(
      await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "試合へ移動しました" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "破棄して移動" }));
    expect(await screen.findByRole("heading", { name: "試合へ移動しました" })).toBeVisible();
  });

  it("protects an in-flight settings creation from browser Back and does not replay the blocked visit", async () => {
    setDevUser();
    const response = createDeferred();
    let requested = false;
    server.use(
      http.post("/api/member-aliases", async () => {
        requested = true;
        await response.promise;
        return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
      }),
    );
    const router = renderRoutedPage("/admin/masters?tab=aliases");
    const alias = await screen.findByRole("textbox", { name: "別名" });
    await user.type(alias, "保存中の別名");
    await user.click(screen.getByRole("button", { name: "追加" }));
    await waitFor(() => expect(requested).toBe(true));
    expect(alias).toBeDisabled();
    try {
      expect(
        screen.getByText(
          "設定の追加・保存・削除の結果を確認しています。完了するまで別の画面への移動をお待ちください。",
          { selector: '[role="status"]' },
        ),
      ).toBeVisible();
      await act(async () => {
        await router.navigate(-1);
      });
      expect(router.state.location.pathname).toBe("/admin/masters");
    } finally {
      response.resolve();
    }
    await waitFor(() => expect(alias).toBeEnabled());
    expect(alias).toHaveValue("保存中の別名");
    expect(
      screen.queryByRole("dialog", { name: "処理結果を確認しています" }),
    ).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/admin/masters");
    expect(screen.queryByRole("heading", { name: "試合へ移動しました" })).not.toBeInTheDocument();
  });

  it.each([
    { label: "マップ", path: "map-masters", store: "mapMasters" },
    { label: "シーズン", path: "season-masters", store: "seasonMasters" },
  ] as const)(
    "keeps $label drafts, pending input and results with their own title",
    async ({ label, path, store }) => {
      setDevUser();
      mswState.gameTitles.push({
        ...mswState.gameTitles[0]!,
        id: "game-b",
        name: "別の作品",
        displayOrder: 1,
      });
      let gate = createDeferred();
      let requests = 0;
      const scopes: string[] = [];
      server.use(
        http.post(`/api/${path}`, async ({ request }) => {
          const payload = (await request.json()) as {
            id: string;
            name: string;
            gameTitleId: string;
          };
          requests += 1;
          scopes.push(payload.gameTitleId);
          await gate.promise;
          if (requests === 1) return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
          const created = { ...payload, createdAt: "2026-01-01T00:00:00.000Z", displayOrder: 99 };
          mswState[store].push(created);
          return HttpResponse.json(created);
        }),
      );
      renderPage();
      const panel = (await screen.findByRole("heading", { name: label })).closest("section")!;
      const input = () => within(panel).getByRole("textbox", { name: "名称" });
      const selectFirst = () =>
        user.click(screen.getByRole("radio", { name: mswState.gameTitles[0]!.name }));
      const selectSecond = () => user.click(screen.getByRole("radio", { name: "別の作品" }));
      await waitFor(() => expect(input()).toBeEnabled());
      await user.type(input(), "元の作品の入力");
      await selectSecond();
      await waitFor(() => expect(input()).toBeEnabled());
      expect(input()).toHaveValue("");
      await user.type(input(), "別の作品の入力");
      await selectFirst();
      expect(input()).toHaveValue("元の作品の入力");
      await user.click(within(panel).getByRole("button", { name: "追加" }));
      await waitFor(() => expect(requests).toBe(1));
      expect(input()).toBeDisabled();
      await selectSecond();
      gate.resolve();
      await waitFor(() => expect(input()).toBeEnabled());
      expect(input()).toHaveValue("別の作品の入力");
      expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
      await selectFirst();
      expect(await within(panel).findByRole("alert")).not.toBeEmptyDOMElement();
      expect(input()).toHaveValue("元の作品の入力");

      gate = createDeferred();
      await user.click(within(panel).getByRole("button", { name: "追加" }));
      await waitFor(() => expect(requests).toBe(2));
      await selectSecond();
      gate.resolve();
      await waitFor(() => expect(input()).toBeEnabled());
      expect(input()).toHaveValue("別の作品の入力");
      expect(within(panel).queryByText(`${label}を追加しました`)).not.toBeInTheDocument();
      await selectFirst();
      expect(input()).toHaveValue("");
      expect(within(panel).getByText(`${label}を追加しました`)).toBeInTheDocument();
      expect(scopes).toEqual(["gt_momotetsu_2", "gt_momotetsu_2"]);
    },
  );

  it("loads accounts only when visited and retains the list through tab changes", async () => {
    setDevUser();
    let accountReads = 0;
    const unrelatedReads: string[] = [];
    server.use(
      http.get("/api/admin/login-accounts", () => {
        accountReads += 1;
        return HttpResponse.json({ items: mswState.loginAccounts });
      }),
      ...["game-titles", "incident-masters", "member-aliases", "map-masters", "season-masters"].map(
        (name) =>
          http.get(`/api/${name}`, () => {
            unrelatedReads.push(name);
            return HttpResponse.json({ items: [] });
          }),
      ),
      http.get("/api/admin/notification-settings", () =>
        HttpResponse.json({
          ocrCompleted: { enabled: true, generation: "0" },
          analysisCompleted: { enabled: true, generation: "0" },
        }),
      ),
    );
    renderPage("/admin/masters?tab=notifications");
    await screen.findByRole("checkbox", { name: "OCR完了" });
    expect(accountReads).toBe(0);
    await user.click(screen.getByRole("tab", { name: "アカウント" }));
    const table = await screen.findByRole("table", {
      name: "登録アカウントとログイン・管理者権限",
    });
    expect(accountReads).toBe(1);
    expect(unrelatedReads).toEqual([]);
    await user.click(screen.getByRole("tab", { name: "通知" }));
    await user.click(screen.getByRole("tab", { name: "アカウント" }));
    expect(screen.getByRole("table")).toBe(table);
    expect(accountReads).toBe(1);
    expect(screen.getByLabelText("current location")).toHaveTextContent("?tab=accounts");
  });

  it("moves tab focus immediately and only loads a new panel after keyboard activation", async () => {
    setDevUser();
    let accountReads = 0;
    server.use(
      http.get("/api/admin/notification-settings", () =>
        HttpResponse.json({
          ocrCompleted: { enabled: true, generation: "0" },
          analysisCompleted: { enabled: true, generation: "0" },
        }),
      ),
      http.get("/api/admin/login-accounts", () => {
        accountReads += 1;
        return HttpResponse.json({ items: mswState.loginAccounts });
      }),
    );
    renderPage("/admin/masters?tab=notifications");
    const selected = await screen.findByRole("tab", { name: "通知", selected: true });
    const accounts = screen.getByRole("tab", { name: "アカウント" });
    await user.click(selected);
    await user.keyboard("{ArrowRight}");
    expect(accounts).toHaveFocus();
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(accountReads).toBe(0);
    expect(screen.getByLabelText("current location")).toHaveTextContent("?tab=notifications");

    await user.keyboard("{Enter}");
    expect(accounts).toHaveFocus();
    expect(accounts).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("table")).toBeVisible();
    expect(accountReads).toBe(1);
  });

  it("isolates account loading and retry while preserving edits in other settings", async () => {
    setDevUser();
    const gate = createDeferred();
    let attempts = 0;
    server.use(
      http.get("/api/admin/login-accounts", async () => {
        attempts += 1;
        await gate.promise;
        return attempts === 1
          ? HttpResponse.json({ detail: "unavailable" }, { status: 503 })
          : HttpResponse.json({ items: mswState.loginAccounts });
      }),
    );
    renderPage("/admin/masters?tab=accounts");
    await screen.findByRole("status", { name: "アカウントを読み込み中" });
    expect(screen.getByRole("button", { name: "アカウントを追加" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "メンバー名寄せ" }));
    await user.type(await screen.findByRole("textbox", { name: /^別名/u }), "編集中の別名");
    await user.click(screen.getByRole("tab", { name: "アカウント" }));
    gate.resolve();
    await user.click(await screen.findByRole("button", { name: "再読み込み" }));
    await screen.findByRole("table");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "ログインと権限" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("tab", { name: "メンバー名寄せ" }));
    expect(screen.getByRole("textbox", { name: /^別名/u })).toHaveValue("編集中の別名");
    expect(attempts).toBe(2);
  });

  it("includes account updates in the shared return guard and retains the committed status", async () => {
    setDevUser();
    const committed = createDeferred();
    server.use(
      http.patch("/api/admin/login-accounts/:accountId", async ({ params }) => {
        await committed.promise;
        const account = mswState.loginAccounts.find(
          (item) => item.accountId === params["accountId"],
        )!;
        account.loginEnabled = false;
        return HttpResponse.json(account);
      }),
    );
    renderPage(`${createMasterReturnEntry()}&tab=accounts`);
    const returnButton = await screen.findByRole("button", { name: "元の入力画面へ戻る" });
    const row = (await screen.findByText("523484457705930755")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "ログイン停止" }));
    await user.click(screen.getByRole("button", { name: "停止する" }));
    expect(returnButton).toBeDisabled();
    committed.resolve();
    await waitFor(() => expect(returnButton).toBeEnabled());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "事件簿" }));
    await user.click(screen.getByRole("tab", { name: "アカウント" }));
    expect(within(row).getByText("ログイン停止")).toBeVisible();
    expect(screen.getByLabelText("current location")).toHaveTextContent("returnTo=");
  });

  it("opens notification settings directly without requesting master resources", async () => {
    setDevUser();
    const masterRequests: string[] = [];
    server.use(
      ...["game-titles", "incident-masters", "member-aliases", "map-masters", "season-masters"].map(
        (name) =>
          http.get(`/api/${name}`, () => {
            masterRequests.push(name);
            return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
          }),
      ),
      http.get("/api/admin/notification-settings", () =>
        HttpResponse.json({
          ocrCompleted: { enabled: true, generation: "0" },
          analysisCompleted: { enabled: false, generation: "0" },
        }),
      ),
    );
    renderPage("/admin/masters?tab=notifications");
    expect(await screen.findByRole("checkbox", { name: "OCR完了" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "分析完了" })).not.toBeChecked();
    expect(screen.getByRole("tab", { name: "通知" })).toHaveAttribute("aria-selected", "true");
    expect(masterRequests).toEqual([]);
  });

  it("keeps tab navigation and notification edits available through a master load failure", async () => {
    setDevUser();
    const masterGate = createDeferred();
    let notificationReads = 0;
    server.use(
      http.get("/api/game-titles", async () => {
        await masterGate.promise;
        return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
      }),
      http.get("/api/admin/notification-settings", () => {
        notificationReads += 1;
        return HttpResponse.json({
          ocrCompleted: { enabled: true, generation: "0" },
          analysisCompleted: { enabled: true, generation: "0" },
        });
      }),
    );
    renderPage();
    expect(await screen.findByRole("status", { name: "作品を読み込み中" })).toBeInTheDocument();
    const notificationsTab = screen.getByRole("tab", { name: "通知" });
    await user.click(notificationsTab);
    const checkbox = await screen.findByRole("checkbox", { name: "OCR完了" });
    await user.click(checkbox);
    await user.click(screen.getByRole("tab", { name: "作品・マップ・シーズン" }));
    masterGate.resolve();
    expect(await screen.findByText("作品を読み込めません")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作品を追加" })).not.toBeInTheDocument();
    const retryGate = createDeferred();
    server.use(
      http.get("/api/game-titles", async () => {
        await retryGate.promise;
        return HttpResponse.json({ items: [] });
      }),
    );
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(screen.getByText("作品を読み込めません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み中" })).toBeDisabled();
    retryGate.resolve();
    expect(await screen.findByRole("heading", { name: "作品" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "作品・マップ・シーズン" })).toHaveFocus();
    await user.click(notificationsTab);
    expect(screen.getByRole("checkbox", { name: "OCR完了" })).toBe(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText("未保存の変更があります")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    expect(screen.getByLabelText("current location")).toHaveTextContent("?tab=notifications");
    expect(notificationReads).toBe(1);
  });

  it("isolates notification loading and failure while retaining edits in another tab", async () => {
    setDevUser();
    const gate = createDeferred();
    server.use(
      http.get("/api/admin/notification-settings", async () => {
        await gate.promise;
        return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
      }),
    );
    renderPage("/admin/masters?tab=notifications");
    expect(await screen.findByRole("status", { name: "通知設定を読み込み中" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "メンバー名寄せ" }));
    const alias = await screen.findByRole("textbox", { name: /^別名/u });
    await user.type(alias, "編集中の別名");
    await user.click(screen.getByRole("tab", { name: "通知" }));
    gate.resolve();
    expect(await screen.findByText("通知設定を読み込めません")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "メンバー名寄せ" }));
    expect(screen.getByRole("textbox", { name: /^別名/u })).toHaveValue("編集中の別名");
  });

  it("keeps notification saving tied to the shared return action across tab changes", async () => {
    setDevUser();
    const committed = createDeferred();
    const saved = {
      ocrCompleted: { enabled: false, generation: "0" },
      analysisCompleted: { enabled: true, generation: "0" },
    };
    server.use(
      http.get("/api/admin/notification-settings", () => HttpResponse.json(saved)),
      http.put("/api/admin/notification-settings", async () => {
        await committed.promise;
        saved.ocrCompleted = { enabled: true, generation: "1" };
        return HttpResponse.json(saved);
      }),
    );
    renderPage(`${createMasterReturnEntry()}&tab=notifications`);
    await user.click(await screen.findByRole("checkbox", { name: "OCR完了" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    const returnButton = screen.getByRole("button", { name: "元の入力画面へ戻る" });
    expect(returnButton).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "事件簿" }));
    expect(returnButton).toBeDisabled();
    committed.resolve();
    await waitFor(() => expect(returnButton).toBeEnabled());
    await user.click(screen.getByRole("tab", { name: "通知" }));
    expect(screen.getByRole("checkbox", { name: "OCR完了" })).toBeChecked();
    expect(screen.getByText("通知設定を保存しました。")).toBeVisible();
    expect(screen.getByLabelText("current location")).toHaveTextContent("returnTo=");
  });

  it("loads only visited tabs, allowing independent tabs to start while another is pending", async () => {
    setDevUser();
    const responseGate = createDeferred();
    const requested = new Set<string>();
    server.use(
      http.get("/api/game-titles", async () => {
        requested.add("game-titles");
        await responseGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/incident-masters", async () => {
        requested.add("incident-masters");
        await responseGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/member-aliases", async () => {
        requested.add("member-aliases");
        await responseGate.promise;
        return HttpResponse.json({ items: [] });
      }),
    );

    renderPage();

    await waitFor(() => expect(requested).toEqual(new Set(["game-titles"])));
    await user.click(screen.getByRole("tab", { name: "メンバー名寄せ" }));
    await waitFor(() => expect(requested).toEqual(new Set(["game-titles", "member-aliases"])));
    await user.click(screen.getByRole("tab", { name: "事件簿" }));
    await waitFor(() =>
      expect(requested).toEqual(new Set(["game-titles", "incident-masters", "member-aliases"])),
    );
    responseGate.resolve();
    expect(await screen.findByRole("region", { name: "設定管理" })).toBeInTheDocument();
  });

  it("shows scoped skeletons while maps and seasons are loading", async () => {
    setDevUser();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/map-masters", async () => {
        await responseGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/season-masters", async () => {
        await responseGate.promise;
        return HttpResponse.json({ items: [] });
      }),
    );

    renderPage();

    expect(await screen.findByRole("region", { name: "設定管理" })).toBeInTheDocument();
    expect(await screen.findByLabelText("マップを読み込み中")).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByLabelText("シーズンを読み込み中")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    responseGate.resolve();
    await waitFor(() =>
      expect(screen.queryByLabelText("マップを読み込み中")).not.toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("シーズンを読み込み中")).not.toBeInTheDocument();
  });

  it("keeps a scoped master failure out of the empty state and retries locally", async () => {
    setDevUser();
    let attempts = 0;
    let shouldFail = true;
    server.use(
      http.get("/api/map-masters", () => {
        attempts += 1;
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [] });
      }),
    );

    renderPage();

    expect(await screen.findByText("マップを読み込めません")).toBeInTheDocument();
    shouldFail = false;
    await user.click(screen.getByRole("button", { name: "マップを再読み込み" }));

    await waitFor(() =>
      expect(screen.queryByText("マップを読み込めません")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("マップはまだありません")).toBeInTheDocument();
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it("keeps cached empty scoped masters visible while retrying stale data", async () => {
    setDevUser();
    queryClient.setQueryData(masterKeys.mapMasters.list("gt_momotetsu_2"), { items: [] });
    let attempts = 0;
    let shouldFail = true;
    server.use(
      http.get("/api/map-masters", () => {
        attempts += 1;
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [] });
      }),
    );

    renderPage();

    const mapPanel = (await screen.findByRole("heading", { name: "マップ" })).closest("section");
    expect(mapPanel).not.toBeNull();
    expect(await within(mapPanel!).findByText("最新のマップを取得できません")).toBeInTheDocument();
    expect(within(mapPanel!).getByText("マップはまだありません")).toBeInTheDocument();
    expect(within(mapPanel!).queryByText("マップを読み込めません")).not.toBeInTheDocument();
    const retryButton = within(mapPanel!).getByRole("button", { name: "マップを再読み込み" });
    expect(within(mapPanel!).getByRole("button", { name: "追加" })).toBeEnabled();

    shouldFail = false;
    await user.click(retryButton);

    await waitFor(() =>
      expect(within(mapPanel!).queryByText("最新のマップを取得できません")).not.toBeInTheDocument(),
    );
    expect(within(mapPanel!).getByText("マップはまだありません")).toBeInTheDocument();
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it("keeps cached empty master directories visible during local retries", async () => {
    setDevUser();
    await queryClient.fetchQuery(authQueryOptions(testDevUserAccountId));
    const staleUpdatedAt = Date.now() - 2_000;
    queryClient.setQueryData(
      masterKeys.gameTitles.list(),
      { items: [] },
      {
        updatedAt: staleUpdatedAt,
      },
    );
    queryClient.setQueryData(
      masterKeys.incidentMasters.list(),
      { items: [] },
      {
        updatedAt: staleUpdatedAt,
      },
    );
    queryClient.setQueryData(
      masterKeys.memberAliases.list(),
      { items: [] },
      {
        updatedAt: staleUpdatedAt,
      },
    );
    let shouldFail = true;
    const attempts = {
      aliases: 0,
      gameTitles: 0,
      incidents: 0,
    };
    server.use(
      http.get("/api/game-titles", () => {
        attempts.gameTitles += 1;
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [] });
      }),
      http.get("/api/incident-masters", () => {
        attempts.incidents += 1;
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [] });
      }),
      http.get("/api/member-aliases", () => {
        attempts.aliases += 1;
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [] });
      }),
    );

    renderPage();

    await waitFor(() => expect(attempts).toEqual({ aliases: 0, gameTitles: 1, incidents: 0 }));
    await waitFor(() =>
      expect(queryClient.getQueryState(masterKeys.gameTitles.list())).toMatchObject({
        status: "error",
      }),
    );

    expect(await screen.findByText("最新の作品を取得できません")).toBeInTheDocument();
    expect(screen.getByText("作品はまだありません")).toBeInTheDocument();
    const gameTitleRetry = screen.getByRole("button", { name: "作品を再読み込み" });
    expect(screen.getByRole("button", { name: "作品を追加" })).toBeEnabled();

    await user.click(screen.getByRole("tab", { name: "メンバー名寄せ" }));
    expect(await screen.findByText("最新の別名を取得できません")).toBeInTheDocument();
    expect(screen.getAllByText("別名なし")).toHaveLength(4);
    const aliasPanel = screen
      .getByRole("heading", { name: "プレーヤー名の別名" })
      .closest("section");
    expect(aliasPanel).not.toBeNull();
    const aliasRetry = within(aliasPanel!).getByRole("button", { name: "別名を再読み込み" });
    expect(within(aliasPanel!).getByRole("button", { name: "追加" })).toBeEnabled();

    await user.click(screen.getByRole("tab", { name: "事件簿" }));
    expect(await screen.findByText("最新の事件簿を取得できません")).toBeInTheDocument();
    expect(screen.queryByText("事件簿の項目数を確認してください")).not.toBeInTheDocument();
    const incidentPanel = screen.getByRole("heading", { name: "事件簿" }).closest("section");
    expect(incidentPanel).not.toBeNull();
    const incidentRetry = within(incidentPanel!).getByRole("button", {
      name: "事件簿を再読み込み",
    });

    shouldFail = false;
    await user.click(incidentRetry);
    await user.click(screen.getByRole("tab", { name: "メンバー名寄せ" }));
    await user.click(aliasRetry);
    await user.click(screen.getByRole("tab", { name: "作品・マップ・シーズン" }));
    await user.click(gameTitleRetry);

    await waitFor(() => {
      expect(screen.queryByText("最新の作品を取得できません")).not.toBeInTheDocument();
      expect(screen.queryByText("最新の別名を取得できません")).not.toBeInTheDocument();
      expect(screen.queryByText("最新の事件簿を取得できません")).not.toBeInTheDocument();
    });
    expect(attempts).toEqual({ aliases: 2, gameTitles: 2, incidents: 2 });
  });

  it("reports an alias refresh failure after the alias was created successfully", async () => {
    setDevUser();
    let failRefresh = false;
    const aliases = [
      {
        alias: "NO11",
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "alias-existing",
        memberId: "member_ponta",
      },
    ];
    server.use(
      http.get("/api/member-aliases", () =>
        failRefresh
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: aliases }),
      ),
      http.post("/api/member-aliases", async ({ request }) => {
        const body = (await request.json()) as { alias: string; memberId: string };
        aliases.push({
          ...body,
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "alias-created",
        });
        failRefresh = true;
        return HttpResponse.json(aliases.at(-1));
      }),
    );

    renderPage("/admin/masters?tab=aliases");

    expect(await screen.findByText("NO11")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("例: NO11社長"), "ポン太");
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(await screen.findByText("最新の別名を取得できません")).toBeInTheDocument();
    expect(screen.getByText("NO11")).toBeInTheDocument();
    expect(screen.getByText("ポン太")).toBeInTheDocument();
    expect(screen.queryByText("別名の追加に失敗しました")).not.toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "別名を再読み込み" });

    failRefresh = false;
    await user.click(retryButton);

    expect(await screen.findByText("ポン太")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("最新の別名を取得できません")).not.toBeInTheDocument(),
    );
  });

  it("rolls back a failed optimistic creation, preserves inputs for retry, and resets after success", async () => {
    setDevUser();
    const failedResponse = createDeferred();
    const submissions: Array<{
      key: string | null;
      payload: { id: string; layoutFamily: string; name: string };
    }> = [];
    server.use(
      http.post("/api/game-titles", async ({ request }) => {
        const payload = (await request.json()) as (typeof submissions)[number]["payload"];
        submissions.push({ key: request.headers.get("Idempotency-Key"), payload });
        if (submissions.length === 1) {
          await failedResponse.promise;
          return HttpResponse.json({ detail: "作品を保存できませんでした" }, { status: 503 });
        }
        const created = { ...payload, createdAt: "2026-01-01T00:00:00.000Z", displayOrder: 99 };
        mswState.gameTitles.push(created);
        return HttpResponse.json(created);
      }),
    );
    renderPage();
    await screen.findByRole("radio", { name: "桃太郎電鉄2" });
    const dialog = await openGameTitleCreateDialog();
    const name = within(dialog).getByRole("textbox", { name: "作品名" });
    const layout = within(dialog).getByRole("combobox", { name: "読み取り方式" });
    await user.type(name, "再送作品");
    await selectOption(user, layout, "world");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(
      await screen.findByRole("radio", { name: "再送作品（追加中）", hidden: true }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "追加中" })).toBeDisabled();
    failedResponse.resolve();

    expect(await within(dialog).findByRole("alert")).not.toBeEmptyDOMElement();
    expect(
      screen.queryByRole("radio", { name: /再送作品/u, hidden: true }),
    ).not.toBeInTheDocument();
    expect(name).toHaveValue("再送作品");
    expect(layout).toHaveTextContent("ワールド");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(await screen.findByRole("radio", { name: "再送作品" })).toBeChecked();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);

    const nextDialog = await openGameTitleCreateDialog();
    expect(within(nextDialog).getByRole("textbox", { name: "作品名" })).toHaveValue("");
    await user.type(within(nextDialog).getByRole("textbox", { name: "作品名" }), "次の作品");
    await user.click(within(nextDialog).getByRole("button", { name: "追加" }));
    expect(await screen.findByRole("radio", { name: "次の作品" })).toBeChecked();
    expect(screen.getAllByRole("radio", { name: "再送作品" })).toHaveLength(1);
    expect(submissions[2]?.key).not.toBe(submissions[1]?.key);
    expect(submissions[2]?.payload.id).not.toBe(submissions[1]?.payload.id);
  });

  it("retains the confirmed creation and selection when the canonical list refresh fails", async () => {
    setDevUser();
    let saved = false;
    server.use(
      http.get("/api/game-titles", () =>
        saved
          ? HttpResponse.json({ detail: "一覧は一時的に取得できません" }, { status: 503 })
          : HttpResponse.json({ items: mswState.gameTitles }),
      ),
      http.post("/api/game-titles", async ({ request }) => {
        const payload = (await request.json()) as {
          id: string;
          name: string;
          layoutFamily: string;
        };
        saved = true;
        return HttpResponse.json({
          ...payload,
          createdAt: "2026-01-01T00:00:00.000Z",
          displayOrder: 99,
        });
      }),
    );
    renderPage();
    await screen.findByRole("radio", { name: "桃太郎電鉄2" });
    const dialog = await openGameTitleCreateDialog();
    await user.type(within(dialog).getByRole("textbox", { name: "作品名" }), "保存済み作品");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(await screen.findByText("最新の作品を取得できません")).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: "保存済み作品" })).toBeChecked();
    expect(screen.getByText("作品を追加しました")).toBeInTheDocument();
    expect(screen.queryByText("(追加中…)")).not.toBeInTheDocument();
  });

  it.each([
    { label: "マップ", path: "map-masters", store: "mapMasters" },
    { label: "シーズン", path: "season-masters", store: "seasonMasters" },
  ] as const)(
    "retains $label input after rollback and retries the same creation",
    async ({ label, path, store }) => {
      setDevUser();
      const response = createDeferred();
      const submissions: Array<{
        key: string | null;
        payload: { id: string; name: string; gameTitleId: string };
      }> = [];
      server.use(
        http.post(`/api/${path}`, async ({ request }) => {
          const payload = (await request.json()) as (typeof submissions)[number]["payload"];
          submissions.push({ key: request.headers.get("Idempotency-Key"), payload });
          if (submissions.length === 1) {
            await response.promise;
            return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
          }
          const created = { ...payload, createdAt: "2026-01-01T00:00:00.000Z", displayOrder: 99 };
          mswState[store].push(created);
          return HttpResponse.json(created);
        }),
      );
      renderPage();
      const panel = (await screen.findByRole("heading", { name: label })).closest("section")!;
      const input = within(panel).getByRole("textbox", { name: "名称" });
      await waitFor(() => expect(input).toBeEnabled());
      await user.type(input, `再送${label}`);
      await user.click(within(panel).getByRole("button", { name: "追加" }));
      expect(await within(panel).findByText("(追加中…)")).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "追加中" })).toBeDisabled();
      response.resolve();
      expect(await within(panel).findByRole("alert")).not.toBeEmptyDOMElement();
      expect(within(panel).queryByText("(追加中…)")).not.toBeInTheDocument();
      expect(input).toHaveValue(`再送${label}`);
      await user.click(within(panel).getByRole("button", { name: "追加" }));
      expect(await within(panel).findByText(`${label}を追加しました`)).toBeInTheDocument();
      expect(within(panel).getByText(`再送${label}`)).toBeInTheDocument();
      await waitFor(() => {
        expect(within(panel).getByRole("button", { name: "追加" })).toBeEnabled();
        expect(within(panel).getByRole("textbox", { name: "名称" })).toHaveValue("");
      });
      expect(submissions).toHaveLength(2);
      expect(submissions[1]).toEqual(submissions[0]);
      expect(submissions[1]?.payload.gameTitleId).toBe("gt_momotetsu_2");
    },
  );

  it("retains the selected player and alias after an unsuccessful creation Action", async () => {
    setDevUser();
    const submissions: Array<{ key: string | null; payload: { alias: string; memberId: string } }> =
      [];
    server.use(
      http.post("/api/member-aliases", async ({ request }) => {
        const payload = (await request.json()) as (typeof submissions)[number]["payload"];
        submissions.push({ key: request.headers.get("Idempotency-Key"), payload });
        if (submissions.length === 1)
          return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
        const created = { ...payload, id: "alias-retried", createdAt: "2026-01-01T00:00:00.000Z" };
        mswState.memberAliases.push(created);
        return HttpResponse.json(created);
      }),
    );
    renderPage("/admin/masters?tab=aliases");
    const player = await screen.findByRole("combobox", { name: "プレーヤー" });
    const alias = screen.getByRole("textbox", { name: /別名/u });
    await selectOption(user, player, "member_ponta");
    await user.type(alias, "再送別名");
    await user.click(screen.getByRole("button", { name: "追加" }));
    expect(await screen.findByRole("alert")).not.toBeEmptyDOMElement();
    expect(alias).toHaveValue("再送別名");
    expect(player).toHaveTextContent("ぽんた");
    await user.click(screen.getByRole("button", { name: "追加" }));
    expect(await screen.findByText("別名を追加しました")).toBeInTheDocument();
    expect(screen.getByText("再送別名")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "追加" })).toBeEnabled();
      expect(screen.getByRole("textbox", { name: /別名/u })).toHaveValue("");
    });
    expect(submissions[1]).toEqual(submissions[0]);
  });

  it("publishes the confirmed title before refresh finishes and keeps it selected through reconciliation", async () => {
    setDevUser();
    const responseGate = createDeferred();
    const refreshStarted = createDeferred();
    const refreshGate = createDeferred();
    const initialGameTitle = mswState.gameTitles[0]!;
    let createdGameTitle: GameTitleResponse | undefined;
    queryClient.setQueryData(masterKeys.gameTitles.list(), { items: [initialGameTitle] });
    server.use(
      http.get("/api/game-titles", async () => {
        if (createdGameTitle) {
          refreshStarted.resolve();
          await refreshGate.promise;
        }
        return HttpResponse.json({
          items: createdGameTitle ? [initialGameTitle, createdGameTitle] : [initialGameTitle],
        });
      }),
      http.post("/api/game-titles", async ({ request }) => {
        const body = (await request.json()) as { id: string; layoutFamily: string; name: string };
        await responseGate.promise;
        createdGameTitle = {
          ...body,
          name: "桃鉄DX（正式名称）",
          createdAt: "2026-01-01T00:00:00.000Z",
          displayOrder: 2,
        };
        return HttpResponse.json(createdGameTitle);
      }),
    );

    renderPage();
    expect(await screen.findByRole("radio", { name: "桃太郎電鉄2" })).toBeChecked();
    const dialog = await openGameTitleCreateDialog();
    await user.type(within(dialog).getByRole("textbox", { name: "作品名" }), "桃鉄DX");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));

    const pendingChoice = await screen.findByRole("radio", {
      name: "桃鉄DX（追加中）",
      hidden: true,
    });
    expect(pendingChoice).toBeDisabled();
    expect(pendingChoice).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "桃太郎電鉄2", hidden: true })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "追加中" })).toBeDisabled();

    await act(async () => {
      responseGate.resolve();
      await refreshStarted.promise;
    });
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "桃鉄DX（正式名称）", hidden: true })).toBeChecked();
    });
    expect(queryClient.getQueryData(masterKeys.gameTitles.list())).toEqual({
      items: [initialGameTitle, createdGameTitle],
    });
    expect(
      screen.queryByRole("radio", { name: "桃鉄DX（追加中）", hidden: true }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "追加中" })).toBeDisabled();

    await act(async () => refreshGate.resolve());
    expect(await screen.findByRole("radio", { name: "桃鉄DX（正式名称）" })).toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("dialog", { name: "作品を追加" })).not.toBeInTheDocument();
  });

  it("shows the six fixed incident masters", async () => {
    setDevUser();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "事件簿" }));
    expect(await screen.findByText("目的地")).toBeInTheDocument();
    expect(screen.getByText("プラス駅")).toBeInTheDocument();
    expect(screen.getByText("マイナス駅")).toBeInTheDocument();
    expect(screen.getByText("カード駅")).toBeInTheDocument();
    expect(screen.getByText("カード売り場")).toBeInTheDocument();
    expect(screen.getByText("スリの銀次")).toBeInTheDocument();
  });

  it("restores the selected tab from the URL and preserves return context", async () => {
    setDevUser();
    renderPage("/admin/masters?tab=aliases&returnTo=%2Fmatches%3Fpage%3D2");

    expect(await screen.findByRole("heading", { name: "プレーヤー名の別名" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "メンバー名寄せ" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("tab", { name: "事件簿" }));
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "/admin/masters?tab=incidents&returnTo=%2Fmatches%3Fpage%3D2",
      ),
    );
  });

  it("updates a game title from the admin controls", async () => {
    setDevUser();
    let idempotencyKey: string | null = null;
    server.use(
      http.patch("/api/game-titles/:id", async ({ params, request }) => {
        idempotencyKey = request.headers.get("Idempotency-Key");
        const body = (await request.json()) as { layoutFamily: string; name: string };
        const id = String(params["id"]);
        mswState.gameTitles = mswState.gameTitles.map((item) =>
          item.id === id ? { ...item, ...body } : item,
        );
        return HttpResponse.json(mswState.gameTitles.find((item) => item.id === id));
      }),
    );
    renderPage();

    const gameTitleChoice = await screen.findByRole("radio", { name: "桃太郎電鉄2" });
    expect(gameTitleChoice).toBeChecked();

    const editButton = screen.getByRole("button", { name: "作品を編集" });
    const deleteButton = screen.getByRole("button", { name: "作品を削除" });
    expect(gameTitleChoice.closest("label")).not.toContainElement(editButton);
    expect(gameTitleChoice.closest("label")).not.toContainElement(deleteButton);
    await user.click(editButton);
    expect(gameTitleChoice).toBeChecked();
    const editDialog = screen.getByRole("dialog", { name: "作品を編集" });
    const nameInput = screen.getByDisplayValue("桃太郎電鉄2");
    expect(editDialog).toContainElement(nameInput);
    await user.clear(nameInput);
    await user.type(nameInput, "桃太郎電鉄2 DX");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("radio", { name: "桃太郎電鉄2 DX" })).toBeChecked();
    expect(idempotencyKey).toMatch(/\S/u);
  });

  it("keeps a failed master deletion in its dialog after the dialog closes", async () => {
    setDevUser();
    server.use(
      http.delete("/api/game-titles/:id", () =>
        HttpResponse.json(
          {
            code: "CONFLICT",
            detail: "作品は試合から参照されています。",
            status: 409,
            title: "Conflict",
            type: "about:blank",
          },
          { status: 409 },
        ),
      ),
    );
    renderPage();

    await screen.findByRole("radio", { name: "桃太郎電鉄2" });
    await user.click(screen.getByRole("button", { name: "作品を削除" }));
    await user.click(screen.getByRole("button", { name: "削除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存済みの状態が変わっています。内容を確認して、もう一度実行してください。",
    );
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    await waitFor(() => expect(screen.queryByText("作品を削除しますか？")).not.toBeInTheDocument());
    expect(screen.queryByText("作品は試合から参照されています。")).not.toBeInTheDocument();
    expect(screen.queryByText("設定の変更に失敗しました")).not.toBeInTheDocument();
  });

  it("creates and deletes member aliases", async () => {
    setDevUser();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "メンバー名寄せ" }));
    expect(await screen.findByRole("heading", { name: "プレーヤー名の別名" })).toBeInTheDocument();
    expect(screen.getByText("NO11")).toBeInTheDocument();
    const aliasPanel = screen
      .getByRole("heading", { name: "プレーヤー名の別名" })
      .closest("section");
    if (!aliasPanel) {
      throw new Error("alias panel was not rendered");
    }
    const aliasPanelScreen = within(aliasPanel);
    await user.type(aliasPanelScreen.getByPlaceholderText("例: NO11社長"), "ポン太");
    await user.click(aliasPanelScreen.getByRole("button", { name: "追加" }));
    expect(await screen.findByText("ポン太")).toBeInTheDocument();

    const no11Row = screen.getByText("NO11").closest("li");
    if (!no11Row) {
      throw new Error("NO11 alias row was not rendered");
    }
    await user.click(within(no11Row).getByRole("button", { name: "別名を削除" }));
    await user.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => expect(screen.queryByText("NO11")).not.toBeInTheDocument());
  });

  it("shows return action with handoff notice when returnTo is provided", async () => {
    setDevUser();
    renderPage(createMasterReturnEntry());

    expect(await screen.findByRole("button", { name: "元の入力画面へ戻る" })).toBeInTheDocument();
    expect(await screen.findByText(/現在の入力内容を保ったまま戻れます/u)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "戻り先を確認" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "元の入力画面へ戻る" })).toHaveLength(1);
  });

  it("keeps an invalid return destination notice in the settings owner surface", async () => {
    setDevUser();
    renderPage("/admin/masters?returnTo=https%3A%2F%2Fexample.com%2Freview");

    const surface = await screen.findByRole("region", { name: "設定管理" });
    expect(within(surface).getByText("戻り先を確認できませんでした")).toBeInTheDocument();
    expect(within(surface).getByText(/試合一覧へ戻る導線だけ/u)).toBeInTheDocument();
  });

  it("disables the only return action while a master edit is pending", async () => {
    setDevUser();
    const requestStarted = createDeferred();
    const responseGate = createDeferred();
    server.use(
      http.patch("/api/game-titles/:id", async ({ request }) => {
        const body = (await request.json()) as { layoutFamily: string; name: string };
        requestStarted.resolve();
        await responseGate.promise;
        return HttpResponse.json({
          ...body,
          createdAt: "2026-01-01T00:00:00.000Z",
          displayOrder: 1,
          id: "gt_momotetsu_2",
        });
      }),
    );

    renderPage(createMasterReturnEntry());

    const returnButton = await screen.findByRole("button", { name: "元の入力画面へ戻る" });
    await screen.findByRole("radio", { name: "桃太郎電鉄2" });
    await user.click(screen.getByRole("button", { name: "作品を編集" }));
    const nameInput = screen.getByDisplayValue("桃太郎電鉄2");
    await user.clear(nameInput);
    await user.type(nameInput, "桃太郎電鉄2 DX");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await requestStarted.promise;
    expect(returnButton).toBeDisabled();
    expect(screen.getByText("設定の追加・保存・削除が完了すると戻れます。")).toBeInTheDocument();

    responseGate.resolve();
    await waitFor(() => expect(returnButton).toBeEnabled());
    expect(
      screen.queryByText("設定の追加・保存・削除が完了すると戻れます。"),
    ).not.toBeInTheDocument();
  });

  it("does not show cached load error after the route error boundary resets it", async () => {
    setDevUser();
    await queryClient.fetchQuery(authQueryOptions(testDevUserAccountId));
    await queryClient
      .fetchQuery({
        queryKey: masterKeys.gameTitles.list(),
        queryFn: async () => {
          throw new Error("cached load error");
        },
      })
      .catch(() => undefined);

    const requestStarted = createDeferred();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/game-titles", async () => {
        requestStarted.resolve();
        await responseGate.promise;
        return HttpResponse.json({
          items: [
            {
              id: "gt_recovered",
              name: "復旧済み作品",
              layoutFamily: "momotetsu_2",
              displayOrder: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }),
    );

    function MasterRouteHarness({ showPage }: { showPage: boolean }) {
      return (
        <QueryClientProvider client={queryClient}>
          <QueryErrorResetBoundary>
            {({ reset }) => (
              <>
                <button type="button" onClick={reset}>
                  Reset query errors
                </button>
                {showPage ? (
                  <MemoryRouter initialEntries={["/admin/masters"]}>
                    <MastersPage />
                  </MemoryRouter>
                ) : null}
              </>
            )}
          </QueryErrorResetBoundary>
        </QueryClientProvider>
      );
    }

    const view = render(<MasterRouteHarness showPage={false} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Reset query errors" }));
    view.rerender(<MasterRouteHarness showPage />);

    await requestStarted.promise;
    expect(screen.queryByText("作品を読み込めませんでした")).not.toBeInTheDocument();
    responseGate.resolve();
    expect(await screen.findByRole("radio", { name: "復旧済み作品" })).toBeChecked();
  });

  it("does not reuse list-response cache entries from OCR setup queries", async () => {
    setDevUser();
    queryClient.setQueryData(masterKeys.gameTitles.list(), {
      items: [
        {
          id: "gt_cached_response",
          name: "別画面キャッシュ",
          layoutFamily: "momotetsu_2",
          displayOrder: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    renderPage();

    expect(await screen.findByRole("region", { name: "設定管理" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("別画面キャッシュ")).not.toBeInTheDocument());
  });
});
