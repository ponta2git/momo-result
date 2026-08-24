import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { appRoutes } from "@/app/router";
import { matchKeys } from "@/shared/api/queryKeys";
import { setDevUser, testDevUserStorageKey } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeFourPlayerResults, makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  analysisArtifact,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisReview,
  makeSeriesAnalysisStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

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

  it("redirects / to /login when unauthenticated", async () => {
    const { router } = renderApp("/");

    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ログイン" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "別のDiscordアカウントを使う場合は、Discord側でログアウトするか、シークレットウィンドウで開きます。",
      ),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("redirects / to /matches when authenticated", async () => {
    setDevUser();
    const { router } = renderApp("/");

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches");
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });

  it("shows a structured loading state while checking the login session", async () => {
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

    renderApp("/matches");

    const loadingState = await screen.findByLabelText("ログイン状態を確認中");
    expect(loadingState).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("ログイン状態を確認中…")).toBeInTheDocument();

    responseGate.resolve();
    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
  });

  it("redirects protected routes to /login with next query when unauthenticated", async () => {
    const { router } = renderApp("/exports");

    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toContain("next=%2Fexports");
  });

  it("redirects /login to /matches when authenticated", async () => {
    setDevUser();
    const { router } = renderApp("/login");

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches");
  });

  it("commits match detail navigation through the lazy route while the detail payload is loading", async () => {
    setDevUser();
    const detailGate = createDeferred();
    let detailRequested = false;
    server.use(
      http.get("/api/matches/:matchId", async ({ params }) => {
        detailRequested = true;
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

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();

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
    await waitFor(() => expect(detailRequested).toBe(true));

    detailGate.resolve();
    await waitFor(() => {
      screen.getByRole("heading", { name: /第1試合の結果/u });
    });
  });

  it("logs out from the global nav in dev auth mode", async () => {
    setDevUser();
    const { queryClient, router } = renderApp("/matches");

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    queryClient.setQueryData(matchKeys.detail("match-secret"), {
      matchId: "match-secret",
      privateNote: "previous session cache",
    });
    await user.click(screen.getByRole("button", { name: "ログアウト" }));

    await waitFor(() => {
      expect(window.localStorage.getItem(testDevUserStorageKey)).toBeNull();
      expect(queryClient.getQueryData(matchKeys.detail("match-secret"))).toBeUndefined();
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  });

  it("renders edit mode at /matches/:matchId/edit", async () => {
    setDevUser();
    const { router } = renderApp("/matches/match-1/edit");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/matches/match-1/edit");
    });
  });

  it("renders held events at /held-events for authenticated users", async () => {
    setDevUser();
    const { router } = renderApp("/held-events");

    expect(await screen.findByRole("heading", { name: "開催履歴" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/held-events");
    expect(screen.getByRole("link", { name: "開催" })).toBeInTheDocument();
  });

  it("loads only the active review, then loads aggregate after switching views", async () => {
    setDevUser();
    const aggregateSearches: URLSearchParams[] = [];
    const reviewSearches: URLSearchParams[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v2/aggregate", ({ request }) => {
        aggregateSearches.push(new URL(request.url).searchParams);
        return HttpResponse.json(makeSeriesAnalysisAggregate());
      }),
      http.get("/api/analytics/series-comparison/v2/review", ({ request }) => {
        reviewSearches.push(new URL(request.url).searchParams);
        return HttpResponse.json(makeSeriesAnalysisReview());
      }),
    );

    const { router } = renderApp("/analytics/series");

    expect(await screen.findByRole("heading", { name: "戦績比較" })).toBeInTheDocument();
    const scopeControl = await screen.findByRole("button", { name: "比較条件" });
    await waitFor(() => expect(scopeControl).toHaveTextContent("12戦"));
    expect(scopeControl).not.toHaveTextContent("十分");
    expect(screen.getByRole("tab", { name: "次戦に備える" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByRole("tabpanel", { name: "次戦に備える" })).toHaveAttribute(
      "id",
      "series-comparison-purpose-panel-review",
    );
    expect(screen.getByText("収益先行時は目的地0回で終えない。")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "根拠・注意・試合後の確認" })[0]!);
    expect(screen.getByText(/収益上位時の勝率: 60%/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));

    expect(aggregateSearches).toHaveLength(0);
    expect(reviewSearches).toHaveLength(1);
    expect(reviewSearches[0]?.get("artifactId")).toBe(analysisArtifact.artifactId);

    await user.click(screen.getByRole("tab", { name: "分析する" }));
    expect(await screen.findByRole("tabpanel", { name: "今の差" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "順位と基礎比較" })).toBeInTheDocument();
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

  it("keeps the last successful artifact visible while a new calculation is running", async () => {
    setDevUser();
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json(
          makeSeriesAnalysisStatus({
            artifactFreshness: "stale",
            calculation: {
              finishedAt: null,
              requestedAt: "2026-08-09T02:00:00.000Z",
              startedAt: "2026-08-09T02:00:01.000Z",
              status: "running",
              trigger: "match_mutation",
            },
          }),
        ),
      ),
    );

    renderApp("/analytics/series");

    const noticeTitle = await screen.findByText("新しい戦績データを計算中です");
    const notice = noticeTitle.closest("section");
    expect(notice).not.toBeNull();
    expect(notice).toHaveTextContent("2026/08/09 10:02更新のデータを表示します");
    expect(await screen.findByText("収益先行時は目的地0回で終えない。")).toBeInTheDocument();
  });

  it("keeps a same-scope prior artifact interactive after replacement loading fails", async () => {
    setDevUser();
    const replacementArtifact = {
      ...analysisArtifact,
      artifactId: "artifact-failing-replacement",
      inputRevision: "13",
      publishedAt: "2026-08-09T03:00:00.000Z",
    };
    let statusRequests = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () => {
        statusRequests += 1;
        return HttpResponse.json(
          makeSeriesAnalysisStatus({
            currentArtifact: statusRequests === 1 ? analysisArtifact : replacementArtifact,
          }),
        );
      }),
      http.get("/api/analytics/series-comparison/v2/review", ({ request }) => {
        const artifactId = new URL(request.url).searchParams.get("artifactId");
        return artifactId === replacementArtifact.artifactId
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json(makeSeriesAnalysisReview());
      }),
    );

    renderApp("/analytics/series");

    expect(await screen.findByText("収益先行時は目的地0回で終えない。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "表示を再読み込み" }));
    expect(await screen.findByText("最新の戦績データを取得できません")).toBeInTheDocument();
    expect(screen.getByText("収益先行時は目的地0回で終えない。")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("比較条件を更新中")).not.toBeInTheDocument());
    const reviewPanel = screen.getByRole("tabpanel", { name: "次戦に備える" });
    expect(reviewPanel.closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "表示を再読み込み" })).toBeEnabled();
  });

  it("does not show an old scope after the newly selected scope fails", async () => {
    setDevUser();
    server.use(
      http.get("/api/analytics/series-comparison/v2/review", ({ request }) => {
        const seasonMasterId = new URL(request.url).searchParams.get("seasonMasterId");
        return seasonMasterId
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json(makeSeriesAnalysisReview());
      }),
    );

    renderApp("/analytics/series");

    expect(await screen.findByText("収益先行時は目的地0回で終えない。")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "シーズン" }), "season_current");
    expect(await screen.findByText("戦績データを読み込めません")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("収益先行時は目的地0回で終えない。")).not.toBeInTheDocument(),
    );
  });

  it("shows a calculation-only empty state before the first artifact is published", async () => {
    setDevUser();
    let aggregateRequests = 0;
    let reviewRequests = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json(
          makeSeriesAnalysisStatus({
            artifactFreshness: "unavailable",
            calculation: {
              finishedAt: null,
              requestedAt: "2026-08-09T02:00:00.000Z",
              startedAt: null,
              status: "queued",
              trigger: "initial_backfill",
            },
            currentArtifact: null,
          }),
        ),
      ),
      http.get("/api/analytics/series-comparison/v2/aggregate", () => {
        aggregateRequests += 1;
        return HttpResponse.json(makeSeriesAnalysisAggregate());
      }),
      http.get("/api/analytics/series-comparison/v2/review", () => {
        reviewRequests += 1;
        return HttpResponse.json(makeSeriesAnalysisReview());
      }),
    );

    renderApp("/analytics/series");

    expect(
      await screen.findByRole("heading", { name: "戦績データの計算を待っています" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("画面を開いたまま待つと、完了後に自動で表示します。"),
    ).toBeInTheDocument();
    expect(aggregateRequests).toBe(0);
    expect(reviewRequests).toBe(0);
  });

  it("pins season and map aggregate requests to the published artifact", async () => {
    setDevUser();
    const aggregateSearches: URLSearchParams[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v2/aggregate", ({ request }) => {
        aggregateSearches.push(new URL(request.url).searchParams);
        return HttpResponse.json(makeSeriesAnalysisAggregate());
      }),
    );
    const { router } = renderApp("/analytics/series?view=overview");

    expect(await screen.findByRole("heading", { name: "戦績比較" })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "シーズン" }), "season_current");
    await user.selectOptions(screen.getByRole("combobox", { name: "マップ" }), "map_east");

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

  it("refreshes status once and moves to the replacement artifact after a 410", async () => {
    setDevUser();
    const replacementArtifact = {
      ...analysisArtifact,
      artifactId: "artifact-replacement",
      inputRevision: "13",
      publishedAt: "2026-08-09T03:00:00.000Z",
    };
    let statusRequests = 0;
    const aggregateArtifactIds: string[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () => {
        statusRequests += 1;
        return HttpResponse.json(
          statusRequests === 1
            ? makeSeriesAnalysisStatus()
            : makeSeriesAnalysisStatus({
                currentArtifact: replacementArtifact,
                desired: {
                  algorithmVersion: replacementArtifact.algorithmVersion,
                  artifactSchemaVersion: replacementArtifact.artifactSchemaVersion,
                  inputRevision: replacementArtifact.inputRevision,
                },
              }),
        );
      }),
      http.get("/api/analytics/series-comparison/v2/aggregate", ({ request }) => {
        const artifactId = new URL(request.url).searchParams.get("artifactId") ?? "";
        aggregateArtifactIds.push(artifactId);
        if (artifactId === analysisArtifact.artifactId) {
          return HttpResponse.json(
            {
              code: "ANALYSIS_ARTIFACT_EXPIRED",
              detail: "The requested artifact is no longer retained.",
              status: 410,
              title: "Artifact expired",
              type: "about:blank",
            },
            { status: 410 },
          );
        }
        return HttpResponse.json(makeSeriesAnalysisAggregate(replacementArtifact));
      }),
      http.get("/api/analytics/series-comparison/v2/review", () => {
        const review = makeSeriesAnalysisReview();
        return HttpResponse.json({ ...review, artifact: replacementArtifact });
      }),
    );

    renderApp("/analytics/series?view=overview");

    expect(await screen.findByRole("heading", { name: "順位と基礎比較" })).toBeInTheDocument();
    expect(statusRequests).toBe(2);
    expect(aggregateArtifactIds).toEqual([
      analysisArtifact.artifactId,
      replacementArtifact.artifactId,
    ]);
  });

  it("recovers an expired review without fetching inactive aggregate data", async () => {
    setDevUser();
    const replacementArtifact = {
      ...analysisArtifact,
      artifactId: "artifact-review-replacement",
      inputRevision: "13",
      publishedAt: "2026-08-09T03:00:00.000Z",
    };
    let statusRequests = 0;
    let aggregateRequests = 0;
    const reviewArtifactIds: string[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () => {
        statusRequests += 1;
        return HttpResponse.json(
          statusRequests === 1
            ? makeSeriesAnalysisStatus()
            : makeSeriesAnalysisStatus({ currentArtifact: replacementArtifact }),
        );
      }),
      http.get("/api/analytics/series-comparison/v2/review", ({ request }) => {
        const artifactId = new URL(request.url).searchParams.get("artifactId") ?? "";
        reviewArtifactIds.push(artifactId);
        if (artifactId === analysisArtifact.artifactId) {
          return HttpResponse.json(
            {
              code: "ANALYSIS_ARTIFACT_EXPIRED",
              detail: "The requested artifact is no longer retained.",
              status: 410,
              title: "Artifact expired",
              type: "about:blank",
            },
            { status: 410 },
          );
        }
        const review = makeSeriesAnalysisReview();
        return HttpResponse.json({ ...review, artifact: replacementArtifact });
      }),
      http.get("/api/analytics/series-comparison/v2/aggregate", () => {
        aggregateRequests += 1;
        return HttpResponse.json(makeSeriesAnalysisAggregate(replacementArtifact));
      }),
    );

    renderApp("/analytics/series");

    expect(await screen.findByText("収益先行時は目的地0回で終えない。")).toBeInTheDocument();
    expect(statusRequests).toBe(2);
    expect(reviewArtifactIds).toEqual([
      analysisArtifact.artifactId,
      replacementArtifact.artifactId,
    ]);
    expect(aggregateRequests).toBe(0);
  });

  it("retries v2 comparison options without showing a false empty state", async () => {
    setDevUser();
    let attempts = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v2/options", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ detail: "failed" }, { status: 500 })
          : HttpResponse.json(makeSeriesAnalysisOptions());
      }),
    );

    renderApp("/analytics/series");

    expect(await screen.findByText("対象作品を読み込めません")).toBeInTheDocument();
    expect(screen.queryByText("登録されている作品がありません")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "比較対象を再読み込み" }));
    expect(await screen.findByRole("combobox", { name: "対象作品" })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("asks a tombstoned v2 client to reload", async () => {
    setDevUser();
    server.use(
      http.get("/api/analytics/series-comparison/v2/options", () =>
        HttpResponse.json(
          {
            code: "ANALYSIS_CLIENT_UPGRADE_REQUIRED",
            detail: "Reload this page to continue.",
            status: 426,
            title: "Client upgrade required",
            type: "about:blank",
          },
          { status: 426 },
        ),
      ),
    );

    renderApp("/analytics/series");

    expect(await screen.findByText("画面の更新が必要です")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "画面を再読み込み" })).toBeInTheDocument();
    expect(screen.queryByText("対象作品を読み込めません")).not.toBeInTheDocument();
  });
});
