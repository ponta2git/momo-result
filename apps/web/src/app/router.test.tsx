import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import {
  loadExportPage,
  loadMastersPage,
  loadMatchDetailPage,
  loadMatchesListPage,
  loadSeriesAnalysisAdminPage,
  loadSeriesComparisonPage,
} from "@/app/routeModules";
import { appRoutes } from "@/app/router";
import type { AuthMeResponse } from "@/shared/api/auth";
import { getCsrfToken } from "@/shared/api/csrfTokenStore";
import { adminAccountKeys, matchKeys } from "@/shared/api/queryKeys";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { decodeSeriesAnalysisAdminOverview } from "@/shared/api/seriesAnalysisEnvelopeSchemas";
import { authMeQueryKey, authMeQueryKeyFor } from "@/shared/auth/authQueries";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeFourPlayerResults, makeMatchDetail } from "@/test/factories";
import { mswState } from "@/test/msw/fixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisAdminOverview,
  makeSeriesAnalysisReview,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();

let user: ReturnType<typeof userEvent.setup>;

function renderApp(initialEntry: string) {
  const queryClient = createTestQueryClient();
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [initialEntry],
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </QueryClientProvider>,
  );

  return { queryClient, router };
}

describe("app routing", () => {
  // Compile the real route modules and lazy validators before interaction waits start.
  // React.lazy, route guards, HTTP requests, and response validation still run normally.
  beforeAll(async () => {
    await Promise.all([
      loadExportPage(),
      loadMastersPage(),
      loadMatchDetailPage(),
      loadMatchesListPage(),
      loadSeriesAnalysisAdminPage(),
      loadSeriesComparisonPage(),
      decodeSeriesAnalysisAdminOverview(makeSeriesAnalysisAdminOverview()),
      decodeSeriesAnalysisArtifact("reviewV3", makeSeriesAnalysisReview()),
    ]);
  });

  beforeEach(() => {
    user = userEvent.setup();
  });

  it.each([false, true])(
    "keeps unknown URLs recoverable (authenticated: %s)",
    async (authenticated) => {
      if (authenticated) setDevUser();
      const { router } = renderApp("/unknown-page?source=bookmark#section");
      expect(await screen.findByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
      const destination = authenticated ? "試合一覧へ戻る" : "ログイン画面へ";
      expect(await screen.findByRole("link", { name: destination })).toHaveAttribute(
        "href",
        authenticated ? "/matches" : "/login",
      );
      expect(router.state.location.pathname).toBe("/unknown-page");
      expect(router.state.location.search).toBe("?source=bookmark");
      expect(router.state.location.hash).toBe("#section");
      expect(document.title).toBe("ページが見つかりません | 桃鉄戦績台帳");
    },
  );

  it.each(["/", "/login?next=%2Fexports"])(
    "recovers an unknown session at %s without treating it as signed out",
    async (entry) => {
      setDevUser();
      let attempts = 0;
      server.use(
        http.get("/api/auth/me", () => {
          attempts += 1;
          return attempts === 1
            ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 503 })
            : HttpResponse.json({
                accountId: "account_ponta",
                csrfToken: "dev",
                displayName: "ぽんた",
                role: "admin",
                memberId: "member_ponta",
              });
        }),
      );
      const { router } = renderApp(entry);
      expect(
        await screen.findByRole("heading", { name: "ログイン状態を確認できません" }),
      ).toBeVisible();
      expect(router.state.location.pathname).toBe(entry.split("?")[0]);
      expect(screen.queryByRole("region", { name: "ログイン" })).not.toBeInTheDocument();
      expect(attempts).toBe(1);
      await user.click(screen.getByRole("button", { name: "再試行" }));
      expect(
        await screen.findByRole("region", { name: entry === "/" ? "試合一覧" : "出力条件" }),
      ).toBeVisible();
      expect(router.state.location.pathname).toBe(entry === "/" ? "/matches" : "/exports");
    },
  );

  it("orients a new page, then preserves focus while its conditions change", async () => {
    setDevUser();
    renderApp("/matches");
    expect(await screen.findByRole("region", { name: "試合一覧" })).toBeVisible();
    expect(document.title).toBe("試合一覧 | 桃鉄戦績台帳");
    await user.click(screen.getByRole("link", { name: "出力" }));
    expect(await screen.findByRole("region", { name: "出力条件" })).toBeVisible();
    expect(document.title).toBe("戦績を出力 | 桃鉄戦績台帳");
    expect(screen.getByRole("main")).toHaveFocus();
    const tsv = screen.getByRole("tab", { name: "TSV" });
    await user.click(tsv);
    expect(tsv).toHaveFocus();
    expect(tsv).toHaveAttribute("aria-selected", "true");
  });

  it("opens comparison through the protected lazy route from global navigation", async () => {
    setDevUser();
    const { router } = renderApp("/matches");
    expect(await screen.findByRole("region", { name: "試合一覧" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "戦績比較" }));
    expect(await screen.findByText("収益先行時は目的地0回で終えない。")).toBeVisible();
    expect(router.state.location.pathname).toBe("/analytics/series");
  });

  it(
    "keeps manually refreshed analysis jobs when returning through the default title route",
    { timeout: 15_000 },
    async () => {
      setDevUser();
      let requests = 0;
      server.use(
        http.get("/api/admin/series-analysis/overview", () => {
          requests += 1;
          const overview = makeSeriesAnalysisAdminOverview();
          for (const job of overview.recentJobs) {
            job.gameTitleName = requests === 1 ? "初回の処理履歴" : "更新済みの処理履歴";
          }
          return HttpResponse.json(overview);
        }),
      );
      const { router } = renderApp("/admin/analysis");
      expect(await screen.findByText("初回の処理履歴")).toBeInTheDocument();
      // Refresh the settled title route, after the default-title URL handoff has committed.
      await waitFor(() =>
        expect(new URLSearchParams(router.state.location.search).get("gameTitleId")).toBe(
          makeSeriesAnalysisAdminOverview().selectedTitle?.gameTitleId,
        ),
      );
      await waitFor(() => expect(screen.getByRole("button", { name: "状態を更新" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "状態を更新" }));
      expect(
        await screen.findByText("更新済みの処理履歴", {}, { timeout: 5000 }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("link", { name: "試合" }));
      expect(await screen.findByRole("region", { name: "試合一覧" })).toBeInTheDocument();
      await user.click(screen.getByRole("link", { name: "分析" }));
      expect(await screen.findByText("更新済みの処理履歴")).toBeInTheDocument();
      expect(screen.queryByText("初回の処理履歴")).not.toBeInTheDocument();
      expect(requests).toBe(2);
    },
  );

  it("keeps a self-disable completion at login and clears it before another account is used", async () => {
    setDevUser();
    const { router } = renderApp("/admin/masters?tab=accounts");
    const row = await screen.findByRole("row", { name: /523484457705930752/u });
    await user.click(within(row).getByRole("button", { name: "ログイン停止" }));
    await user.click(screen.getByRole("button", { name: "停止する" }));
    expect(
      await screen.findByText("このアカウントのログインを無効にしました。"),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(
      screen.queryByRole("dialog", { name: "アカウント設定を更新しました" }),
    ).not.toBeInTheDocument();
    await selectOption(
      user,
      screen.getByRole("combobox", { name: "操作用アカウント" }),
      "account_eu",
    );
    await user.click(await screen.findByRole("link", { name: "試合" }));
    expect(await screen.findByRole("region", { name: "試合一覧" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches");
    expect(
      screen.queryByText("このアカウントのログインを無効にしました。"),
    ).not.toBeInTheDocument();
  });

  it("denies the settings route and management navigation to a regular user", async () => {
    setDevUser("account_eu");
    mswState.loginAccounts.find((account) => account.accountId === "account_eu")!.role = "user";
    let accountReads = 0;
    server.use(
      http.get("/api/admin/login-accounts", () => {
        accountReads += 1;
        return HttpResponse.json({ items: structuredClone(mswState.loginAccounts) });
      }),
    );

    renderApp("/admin/masters?tab=accounts");

    expect(await screen.findByText("この画面は運用担当・管理者専用です。")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "設定管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "設定" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "分析" })).not.toBeInTheDocument();
    expect(accountReads).toBe(0);
  });

  it("lets an operator use catalog and incidents while denying administrator-only settings", async () => {
    setDevUser("account_eu");
    mswState.loginAccounts.find((account) => account.accountId === "account_eu")!.role = "operator";
    const restrictedReads: string[] = [];
    server.use(
      ...[
        "/api/admin/login-accounts",
        "/api/admin/notification-settings",
        "/api/member-aliases",
      ].map((path) =>
        http.get(path, () => {
          restrictedReads.push(path);
          return HttpResponse.json({ detail: "forbidden" }, { status: 403 });
        }),
      ),
    );
    const { router } = renderApp("/admin/masters?tab=accounts");

    expect(await screen.findByText("この設定項目は管理者専用です。")).toBeInTheDocument();
    const settings = screen.getByRole("region", { name: "設定管理" });
    expect(
      within(settings)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["作品・マップ・シーズン", "実績", "事件簿"]);
    expect(screen.queryByRole("tabpanel", { name: "アカウント" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "分析" })).toBeInTheDocument();
    expect(router.state.location.search).toBe("?tab=accounts");

    await user.click(within(settings).getByRole("tab", { name: "作品・マップ・シーズン" }));
    expect((await screen.findAllByRole("button", { name: "マップを編集" })).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole("button", { name: "作品を追加" })).not.toBeInTheDocument();
    await user.click(within(settings).getByRole("tab", { name: "事件簿" }));
    expect(await screen.findByText("現在は6項目固定です。追加・編集はできません。")).toBeVisible();
    expect(restrictedReads).toEqual([]);
  });

  it.each(["user", "operator"] as const)(
    "revokes administrator settings after self-demotion to %s without ending the session",
    async (role) => {
      vi.stubEnv("DEV", false);
      mswState.loginAccounts.find((account) => account.accountId === "account_eu")!.role = "admin";
      let holdReads = false;
      let accountReads = 0;
      const staleReads: Request[] = [];
      const releaseReads = createDeferred();
      const authReadStarted = createDeferred();
      const accountReadStarted = createDeferred();
      const patchStarted = createDeferred();
      const releasePatch = createDeferred();
      server.use(
        http.get("/api/auth/me", async ({ request }) => {
          const account = mswState.loginAccounts.find(
            (item) => item.accountId === "account_ponta",
          )!;
          const snapshot: AuthMeResponse = {
            accountId: account.accountId,
            csrfToken: "session-csrf",
            displayName: account.displayName,
            role: account.role,
            ...(account.playerMemberId ? { memberId: account.playerMemberId } : {}),
          };
          if (holdReads) {
            staleReads.push(request);
            authReadStarted.resolve();
            await releaseReads.promise;
          }
          return HttpResponse.json(snapshot);
        }),
        http.get("/api/admin/login-accounts", async ({ request }) => {
          accountReads += 1;
          const snapshot = structuredClone(mswState.loginAccounts);
          if (holdReads) {
            staleReads.push(request);
            accountReadStarted.resolve();
            await releaseReads.promise;
          }
          return HttpResponse.json({ items: snapshot });
        }),
        http.patch("/api/admin/login-accounts/:accountId", async ({ params, request }) => {
          const body = (await request.json()) as { role: AuthMeResponse["role"] };
          patchStarted.resolve();
          await releasePatch.promise;
          const account = mswState.loginAccounts.find(
            (item) => item.accountId === String(params["accountId"]),
          )!;
          account.role = body.role;
          return HttpResponse.json(account);
        }),
      );
      const { queryClient } = renderApp("/admin/masters?tab=accounts");
      const row = await screen.findByRole("row", { name: /523484457705930752/u });
      const draftKey = "momoresult.matchWorkspaceDraft.v2.account_ponta.review.session-1";
      window.sessionStorage.setItem(draftKey, "unfinished draft");
      await user.click(within(row).getByRole("button", { name: "ロール変更" }));
      const dialog = screen.getByRole("alertdialog", { name: "ロールを変更しますか？" });
      await selectOption(user, within(dialog).getByRole("combobox", { name: "ロール" }), role);

      await user.click(within(dialog).getByRole("button", { name: "変更する" }));
      await patchStarted.promise;
      holdReads = true;
      let pendingReads: Array<Promise<unknown>> = [];
      act(() => {
        pendingReads = [
          queryClient.refetchQueries({ queryKey: adminAccountKeys.all() }),
          queryClient.refetchQueries({ queryKey: authMeQueryKey }),
        ];
      });
      await Promise.all([authReadStarted.promise, accountReadStarted.promise]);
      expect(staleReads).toHaveLength(2);
      try {
        await act(async () => releasePatch.resolve());
        if (role === "operator") {
          expect(await screen.findByText("この設定項目は管理者専用です。")).toBeInTheDocument();
          expect(screen.getByRole("region", { name: "設定管理" })).toBeVisible();
          expect(screen.getByRole("link", { name: "設定" })).toBeInTheDocument();
          expect(screen.getByRole("link", { name: "分析" })).toBeInTheDocument();
        } else {
          expect(
            await screen.findByText("この画面は運用担当・管理者専用です。"),
          ).toBeInTheDocument();
          expect(screen.queryByRole("region", { name: "設定管理" })).not.toBeInTheDocument();
          expect(screen.queryByRole("link", { name: "設定" })).not.toBeInTheDocument();
          expect(screen.queryByRole("link", { name: "分析" })).not.toBeInTheDocument();
        }
        expect(screen.queryByRole("tabpanel", { name: "アカウント" })).not.toBeInTheDocument();
        expect(staleReads.every((request) => request.signal.aborted)).toBe(true);
      } finally {
        releasePatch.resolve();
        releaseReads.resolve();
      }
      await act(async () => {
        await Promise.all(pendingReads);
      });

      expect(queryClient.getQueryData(adminAccountKeys.all())).toBeUndefined();
      expect(queryClient.getQueryData(authMeQueryKeyFor(undefined))).toMatchObject({
        accountId: "account_ponta",
        csrfToken: "session-csrf",
        role,
      });
      expect(getCsrfToken()).toBe("session-csrf");
      expect(window.sessionStorage.getItem(draftKey)).toBe("unfinished draft");
      // Initial load and the deliberately started stale read are the only allowed account reads.
      expect(accountReads).toBe(2);
    },
  );

  it("preserves an open map edit through an unavailable authorization recheck without issuing restricted requests", async () => {
    setDevUser("account_eu");
    const auth: AuthMeResponse = {
      accountId: "account_eu",
      csrfToken: "dev",
      displayName: "いーゆー",
      role: "operator",
      memberId: "member_eu",
    };
    let authChecks = 0;
    let permissionKnown = true;
    let mapReads = 0;
    const writes: string[] = [];
    const forbiddenRequests: string[] = [];
    const recheckStarted = createDeferred();
    const releaseRecheck = createDeferred();
    server.use(
      http.get("/api/auth/me", async () => {
        authChecks += 1;
        if (authChecks === 2) {
          recheckStarted.resolve();
          await releaseRecheck.promise;
          return HttpResponse.json({ detail: "temporarily unavailable" }, { status: 503 });
        }
        permissionKnown = true;
        return HttpResponse.json(auth);
      }),
      http.get("/api/map-masters", ({ request }) => {
        mapReads += 1;
        if (!permissionKnown) forbiddenRequests.push("GET map-masters during recheck");
        const gameTitleId = new URL(request.url).searchParams.get("gameTitleId");
        return HttpResponse.json({
          items: mswState.mapMasters.filter((map) => map.gameTitleId === gameTitleId),
        });
      }),
      http.patch("/api/map-masters/:id", async ({ params, request }) => {
        if (!permissionKnown) forbiddenRequests.push("PATCH map-masters during recheck");
        const body = (await request.json()) as { name: string };
        writes.push(body.name);
        const map = mswState.mapMasters.find((item) => item.id === String(params["id"]))!;
        map.name = body.name;
        return HttpResponse.json(map);
      }),
      ...[
        "/api/admin/login-accounts",
        "/api/admin/notification-settings",
        "/api/member-aliases",
      ].flatMap((path) => [
        http.get(path, () => {
          forbiddenRequests.push(`GET ${path}`);
          return HttpResponse.json({ detail: "forbidden" }, { status: 403 });
        }),
        http.post(path, () => {
          forbiddenRequests.push(`POST ${path}`);
          return HttpResponse.json({ detail: "forbidden" }, { status: 403 });
        }),
      ]),
    );
    const { queryClient } = renderApp("/admin/masters");
    await user.click((await screen.findAllByRole("button", { name: "マップを編集" }))[0]!);
    const dialog = screen.getByRole("dialog", { name: "マップを編集" });
    const nameInput = within(dialog).getByRole("textbox", { name: "マップ名" });
    await user.clear(nameInput);
    await user.type(nameInput, "再確認後まで保持するマップ");
    const readsBeforeRecheck = mapReads;

    permissionKnown = false;
    let pendingRecheck: Promise<unknown>;
    act(() => {
      pendingRecheck = queryClient.refetchQueries({ queryKey: authMeQueryKey });
    });
    try {
      await recheckStarted.promise;
      expect(await screen.findByText("権限を確認中…")).toBeVisible();
      expect(nameInput).not.toBeVisible();
      expect(screen.queryByRole("dialog", { name: "マップを編集" })).not.toBeInTheDocument();
      expect(mapReads).toBe(readsBeforeRecheck);
      expect(writes).toEqual([]);
    } finally {
      releaseRecheck.resolve();
    }
    await act(async () => pendingRecheck!);
    expect(
      await screen.findByRole("heading", { name: "ログイン状態を確認できません" }),
    ).toBeVisible();
    expect(nameInput).not.toBeVisible();
    expect(mapReads).toBe(readsBeforeRecheck);
    expect(writes).toEqual([]);
    await user.click(screen.getByRole("button", { name: "再試行" }));

    const restoredDialog = await screen.findByRole("dialog", { name: "マップを編集" });
    expect(within(restoredDialog).getByRole("textbox", { name: "マップ名" })).toHaveValue(
      "再確認後まで保持するマップ",
    );
    await user.click(within(restoredDialog).getByRole("button", { name: "保存" }));
    expect(await screen.findByText("マップを保存しました")).toBeInTheDocument();
    expect(writes).toEqual(["再確認後まで保持するマップ"]);
    expect(forbiddenRequests).toEqual([]);
    expect(authChecks).toBe(3);
  });

  it("opens the requested notification settings tab directly", async () => {
    setDevUser();
    server.use(
      http.get("/api/admin/notification-settings", () =>
        HttpResponse.json({
          ocrCompleted: { enabled: true, generation: "0" },
          analysisCompleted: { enabled: false, generation: "0" },
        }),
      ),
    );
    const { router } = renderApp("/admin/masters?tab=notifications");
    expect(await screen.findByRole("checkbox", { name: "OCR完了" })).toBeChecked();
    expect(router.state.location.pathname).toBe("/admin/masters");
    expect(router.state.location.search).toBe("?tab=notifications");
    expect(screen.getByRole("tab", { name: "通知" })).toHaveAttribute("aria-selected", "true");
  });

  it("redirects / to /login when unauthenticated", async () => {
    const { router } = renderApp("/");

    expect(await screen.findByRole("region", { name: "ログイン" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("redirects / to /matches when authenticated", async () => {
    setDevUser();
    const { router } = renderApp("/");

    expect(
      await screen.findByRole("region", { name: "試合一覧" }, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches");
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });

  it("retains input for the same account but discards it when auth confirms another account", async () => {
    vi.stubEnv("DEV", false);
    let accountId = "account-first";
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ accountId, displayName: accountId, role: "user" }),
      ),
      http.get("/api/matches/match-1", () =>
        HttpResponse.json(
          makeMatchDetail({
            note: { body: "保存済みのメモ", version: "1" },
            players: makeFourPlayerResults(),
          }),
        ),
      ),
    );
    const { queryClient } = renderApp("/matches/match-1");
    await user.click(await screen.findByRole("button", { name: "編集" }));
    const input = screen.getByRole("textbox", { name: "試合メモ" });
    await user.clear(input);
    await user.type(input, "前のアカウントの未保存メモ");

    await act(async () => queryClient.refetchQueries({ queryKey: authMeQueryKey }));
    expect(input).toHaveValue("前のアカウントの未保存メモ");

    accountId = "account-second";
    await act(async () => queryClient.refetchQueries({ queryKey: authMeQueryKey }));

    expect(await screen.findByRole("button", { name: "編集" })).toBeEnabled();
    expect(screen.queryByRole("textbox", { name: "試合メモ" })).not.toBeInTheDocument();
    expect(screen.queryByText("前のアカウントの未保存メモ")).not.toBeInTheDocument();
    expect(screen.getByText("保存済みのメモ")).toBeVisible();
  });

  it.each(["same", "other", "expired", "forbidden"] as const)(
    "reconciles unsaved input after a transient auth failure (%s account)",
    async (outcome) => {
      vi.stubEnv("DEV", false);
      let phase: "initial" | "unavailable" | "recovered" = "initial";
      server.use(
        http.get("/api/auth/me", () => {
          if (phase === "unavailable")
            return HttpResponse.json({ detail: "temporarily unavailable" }, { status: 503 });
          if (phase === "recovered" && (outcome === "expired" || outcome === "forbidden"))
            return HttpResponse.json(
              { detail: "session rejected" },
              { status: outcome === "expired" ? 401 : 403 },
            );
          return HttpResponse.json({
            accountId:
              phase === "recovered" && outcome === "other" ? "account-next" : "account-first",
            displayName: "利用者",
            role: "user",
          });
        }),
        http.get("/api/matches/match-1", () =>
          HttpResponse.json(
            makeMatchDetail({
              note: { body: "保存済みのメモ", version: "1" },
              players: makeFourPlayerResults(),
            }),
          ),
        ),
      );
      const { queryClient, router } = renderApp("/matches/match-1");
      await user.click(await screen.findByRole("button", { name: "編集" }));
      const input = screen.getByRole("textbox", { name: "試合メモ" });
      await user.clear(input);
      await user.type(input, "接続が戻るまで保持するメモ");

      phase = "unavailable";
      await act(async () => queryClient.refetchQueries({ queryKey: authMeQueryKey }));
      expect(
        await screen.findByRole("heading", { name: "ログイン状態を確認できません" }),
      ).toBeVisible();
      expect(screen.getByRole("textbox", { name: "試合メモ" })).toBe(input);
      expect(input).toHaveValue("接続が戻るまで保持するメモ");

      phase = "recovered";
      await user.click(screen.getByRole("button", { name: "ログイン状態を再確認" }));
      await waitFor(() =>
        expect(
          screen.queryByRole("heading", { name: "ログイン状態を確認できません" }),
        ).not.toBeInTheDocument(),
      );
      if (outcome === "same") {
        expect(screen.getByRole("textbox", { name: "試合メモ" })).toBe(input);
        expect(input).toHaveValue("接続が戻るまで保持するメモ");
      } else {
        expect(screen.queryByRole("textbox", { name: "試合メモ" })).not.toBeInTheDocument();
        expect(screen.queryByText("接続が戻るまで保持するメモ")).not.toBeInTheDocument();
        if (outcome === "other") {
          expect(await screen.findByText("保存済みのメモ")).toBeVisible();
        } else {
          expect(await screen.findByRole("region", { name: "ログイン" })).toBeVisible();
          expect(router.state.location.pathname).toBe("/login");
        }
      }
    },
  );

  it("waits for the login session before exposing protected content", async () => {
    setDevUser();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/auth/me", async () => {
        await responseGate.promise;
        return HttpResponse.json({
          accountId: "account_ponta",
          csrfToken: "dev",
          displayName: "ぽんた",
          role: "admin",
          memberId: "member_ponta",
        });
      }),
    );

    const { router } = renderApp("/matches");

    const loadingState = await screen.findByLabelText("ログイン状態を確認中…");
    expect(within(loadingState).getByRole("status")).toHaveTextContent("ログイン状態を確認中…");
    expect(screen.queryByRole("region", { name: "試合一覧" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "ログイン" })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches");

    responseGate.resolve();
    expect(await screen.findByRole("region", { name: "試合一覧" })).toBeInTheDocument();
  });

  it("redirects protected routes to /login with next query when unauthenticated", async () => {
    const { router } = renderApp("/exports");

    expect(await screen.findByRole("region", { name: "ログイン" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toContain("next=%2Fexports");
  });

  it("redirects a forbidden account to a login recovery path", async () => {
    setDevUser("account-disabled");
    const { router } = renderApp("/exports?format=tsv&matchId=match-1#download");

    expect(await screen.findByText("アクセス権限がありません")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "ログイン" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    const recoveryParams = new URLSearchParams(router.state.location.search);
    expect(recoveryParams.get("reason")).toBe("forbidden");
    expect(recoveryParams.get("next")).toBe("/exports?format=tsv&matchId=match-1#download");

    await selectOption(
      user,
      screen.getByRole("combobox", { name: "操作用アカウント" }),
      "account_ponta",
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/exports");
      expect(router.state.location.search).toBe("?format=tsv&matchId=match-1");
      expect(router.state.location.hash).toBe("#download");
    });
  });

  it("recovers the requested route after retrying authentication", async () => {
    setDevUser();
    let attempts = 0;
    server.use(
      http.get("/api/auth/me", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json(
              {
                code: "TEMPORARILY_UNAVAILABLE",
                detail: "auth temporarily unavailable",
                status: 500,
                title: "Temporary failure",
                type: "about:blank",
              },
              { status: 500 },
            )
          : HttpResponse.json({
              accountId: "account_ponta",
              csrfToken: "dev",
              displayName: "ぽんた",
              role: "admin",
              memberId: "member_ponta",
            });
      }),
    );

    renderApp("/matches");

    const retry = await screen.findByRole("button", { name: "再試行" });
    expect(
      screen.getByRole("region", { name: "ログイン状態を確認できません" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Temporary failure")).not.toBeInTheDocument();
    expect(screen.queryByText("auth temporarily unavailable")).not.toBeInTheDocument();
    await user.click(retry);

    expect(await screen.findByRole("region", { name: "試合一覧" })).toBeInTheDocument();
    expect(screen.queryByText("Temporary failure")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再試行" })).not.toBeInTheDocument();
  });

  it("keeps global navigation and authentication retry available before detail loads", async () => {
    setDevUser();
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ detail: "auth temporarily unavailable" }, { status: 500 }),
      ),
    );

    renderApp("/held-events/held-1");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "ログイン状態を確認できません",
      }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "開催" })).toHaveAttribute("href", "/held-events");
    expect(screen.getByRole("button", { name: "再試行" })).toBeEnabled();
  });

  it("redirects /login to /matches when authenticated", async () => {
    setDevUser();
    const { router } = renderApp("/login");

    expect(await screen.findByRole("region", { name: "試合一覧" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches");
  });

  it("commits match detail navigation through the lazy route while the detail payload is loading", async () => {
    setDevUser();
    const detailGate = createDeferred();
    server.use(
      http.get("/api/matches/:matchId", async ({ params }) => {
        await detailGate.promise;
        return HttpResponse.json(
          makeMatchDetail({
            matchId: String(params["matchId"]),
            players: makeFourPlayerResults(),
          }),
        );
      }),
    );
    const { router } = renderApp("/matches");

    expect(await screen.findByRole("region", { name: "試合一覧" })).toBeInTheDocument();

    const detailLinks = await screen.findAllByRole("link", {
      name: "第1試合 · 東日本編",
    });
    const detailLink = detailLinks[0];
    if (!detailLink) throw new Error("expected a detail link");
    await user.click(detailLink);

    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe("/matches/match-1");
        expect(screen.getByLabelText("試合詳細を読み込み中")).toHaveAttribute("aria-busy", "true");
      },
      { timeout: 5_000 },
    );

    detailGate.resolve();
    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeVisible();
  });

  it("logs out from the local default account and lets the operator switch roles", async () => {
    vi.stubEnv("VITE_DEV_USER", "account_ponta");
    let logoutRequests = 0;
    server.use(
      http.post("/api/auth/logout", () => {
        logoutRequests += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    try {
      const { queryClient, router } = renderApp("/matches");

      expect(await screen.findByRole("region", { name: "試合一覧" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "設定" })).toBeInTheDocument();
      queryClient.setQueryData(matchKeys.detail("match-secret"), {
        matchId: "match-secret",
        privateNote: "previous session cache",
      });
      await user.click(screen.getByRole("button", { name: "ログアウト" }));

      await waitFor(() => {
        expect(queryClient.getQueryData(matchKeys.detail("match-secret"))).toBeUndefined();
        expect(router.state.location.pathname).toBe("/login");
      });
      const accountPicker = await screen.findByRole("combobox", { name: "操作用アカウント" });
      expect(screen.getByRole("region", { name: "ログイン" })).toBeInTheDocument();
      expect(accountPicker).toBeEnabled();
      await selectOption(user, accountPicker, "account_eu");

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/matches");
      });
      const globalNavigation = await screen.findByRole("navigation", {
        name: "グローバルナビゲーション",
      });
      expect(within(globalNavigation).getByText("いーゆー")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "設定" })).not.toBeInTheDocument();
      expect(logoutRequests).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
