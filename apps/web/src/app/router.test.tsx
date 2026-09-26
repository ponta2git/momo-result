import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { appRoutes } from "@/app/router";
import { matchKeys } from "@/shared/api/queryKeys";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeFourPlayerResults, makeMatchDetail } from "@/test/factories";
import { mswState } from "@/test/msw/fixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  analysisArtifact,
  makeSeriesAnalysisAggregate,
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
                isAdmin: true,
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

  // These flows load cold route chunks under coverage; their total budget must exceed each wait.
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
    await user.click(await screen.findByRole("link", { name: "試合一覧へ戻る" }));
    expect(await screen.findByRole("region", { name: "試合一覧" })).toBeInTheDocument();
    expect(
      screen.queryByText("このアカウントのログインを無効にしました。"),
    ).not.toBeInTheDocument();
  });

  it("prevents a non-admin from opening protected settings", async () => {
    setDevUser("account_eu");
    renderApp("/admin/masters?tab=accounts");
    expect(await screen.findByText("この画面は管理者専用です。")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "設定管理" })).not.toBeInTheDocument();
  });

  it("revokes access to settings after removing the current account's admin permission", async () => {
    setDevUser();
    mswState.loginAccounts.find((account) => account.accountId === "account_eu")!.isAdmin = true;
    renderApp("/admin/masters?tab=accounts");
    const row = await screen.findByRole("row", { name: /523484457705930752/u });
    await user.click(within(row).getByRole("button", { name: "管理者解除" }));
    await user.click(screen.getByRole("button", { name: "解除する" }));
    expect(await screen.findByText("この画面は管理者専用です。")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "設定管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "設定" })).not.toBeInTheDocument();
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
          isAdmin: true,
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
              isAdmin: true,
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

  it("keeps a route exit available when authentication fails before detail loads", async () => {
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
    const back = screen.getByRole("link", { name: "開催履歴へ戻る" });
    expect(back).toHaveAttribute("href", "/held-events");
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
      name: "第1試合 東日本編の試合結果を見る",
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

  it("loads only the active review, then loads aggregate after switching views", async () => {
    setDevUser();
    const aggregateResponseGate = createDeferred();
    const aggregateSearches: URLSearchParams[] = [];
    const reviewSearches: URLSearchParams[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v4/aggregate", async ({ request }) => {
        aggregateSearches.push(new URL(request.url).searchParams);
        await aggregateResponseGate.promise;
        return HttpResponse.json(makeSeriesAnalysisAggregate());
      }),
      http.get("/api/analytics/series-comparison/v3/review", ({ request }) => {
        reviewSearches.push(new URL(request.url).searchParams);
        return HttpResponse.json(makeSeriesAnalysisReview());
      }),
    );

    const { router } = renderApp("/analytics/series");

    expect(await screen.findByRole("region", { name: "戦績比較" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "次戦に備える" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("収益先行時は目的地0回で終えない。")).toBeInTheDocument();

    expect(aggregateSearches).toHaveLength(0);
    expect(reviewSearches).toHaveLength(1);

    // Control API readiness without timing the first transform of the lazy view or validator.
    // Both real modules still run; their cold loading belongs to build/runtime evidence.
    await Promise.all([
      import("@/features/seriesComparison/page/SeriesAnalysisOverviewView"),
      import("@/shared/api/generatedContracts/series-analysis-aggregate-v4-validators.generated"),
    ]);
    const analysisPurposeTab = screen.getByRole("tab", { name: "分析する" });
    await user.click(analysisPurposeTab);
    expect(screen.getByLabelText("分析を読み込み中")).toBeInTheDocument();
    expect(analysisPurposeTab).toHaveAttribute("aria-selected", "true");
    expect(analysisPurposeTab).toHaveFocus();
    await act(async () => {
      aggregateResponseGate.resolve();
    });
    expect(await screen.findByRole("heading", { name: "順位と基礎比較" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "今の差" })).toBeInTheDocument();
    expect(analysisPurposeTab).toHaveFocus();
    expect(router.state.location.search).toContain("view=overview");

    expect(aggregateSearches).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "次戦に備える" }));
    expect(await screen.findByRole("tabpanel", { name: "次戦に備える" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "分析する" }));
    expect(await screen.findByRole("tabpanel", { name: "今の差" })).toBeInTheDocument();

    expect(aggregateSearches).toHaveLength(1);
    expect(reviewSearches).toHaveLength(1);
    expect(
      aggregateSearches.every((params) => params.get("artifactId") === analysisArtifact.artifactId),
    ).toBe(true);
    expect(
      reviewSearches.every((params) => params.get("artifactId") === analysisArtifact.artifactId),
    ).toBe(true);
  });

  it("pins season and map aggregate requests to the published artifact", async () => {
    setDevUser();
    const aggregateSearches: URLSearchParams[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v4/aggregate", ({ request }) => {
        aggregateSearches.push(new URL(request.url).searchParams);
        return HttpResponse.json(makeSeriesAnalysisAggregate());
      }),
    );
    const { router } = renderApp("/analytics/series?view=overview");

    expect(await screen.findByRole("region", { name: "戦績比較" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /比較対象を変更/u }));
    await selectOption(user, screen.getByRole("combobox", { name: "シーズン" }), "season_current");
    await selectOption(user, screen.getByRole("combobox", { name: "マップ" }), "map_east");

    await waitFor(() => {
      expect(router.state.location.search).toContain("seasonMasterId=season_current");
      expect(router.state.location.search).toContain("mapMasterId=map_east");
      expect(
        aggregateSearches.some(
          (params) =>
            params.get("artifactId") === analysisArtifact.artifactId &&
            params.get("seasonMasterId") === "season_current" &&
            params.get("mapMasterId") === "map_east",
        ),
      ).toBe(true);
    });
  });
});
