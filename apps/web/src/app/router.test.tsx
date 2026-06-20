import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { appRoutes } from "@/app/router";
import { matchKeys } from "@/shared/api/queryKeys";
import { createDeferred } from "@/test/deferred";
import { makeFourPlayerResults, makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesComparisonResponse } from "@/test/msw/seriesComparisonHandlers";
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
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const { router } = renderApp("/");

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches");
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });

  it("shows a structured loading state while checking the login session", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const { router } = renderApp("/login");

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches");
  });

  it("commits match detail navigation through the lazy route while the detail payload is loading", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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

    const detailLinks = await screen.findAllByRole("link", { name: "詳細を見る" });
    const detailLink = detailLinks[0];
    if (!detailLink) {
      throw new Error("expected a detail link");
    }
    await user.click(detailLink);

    await waitFor(() => expect(router.state.location.pathname).toBe("/matches/match-1"));
    expect(await screen.findByLabelText("試合詳細を読み込み中")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await waitFor(() => expect(detailRequested).toBe(true));

    detailGate.resolve();
    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
  });

  it("logs out from the global nav in dev auth mode", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const { queryClient, router } = renderApp("/matches");

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    queryClient.setQueryData(matchKeys.detail("match-secret"), {
      matchId: "match-secret",
      privateNote: "previous session cache",
    });
    await user.click(screen.getByRole("button", { name: "ログアウト" }));

    await waitFor(() => {
      expect(window.localStorage.getItem("momoresult.devUser")).toBeNull();
      expect(queryClient.getQueryData(matchKeys.detail("match-secret"))).toBeUndefined();
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  });

  it("renders edit mode at /matches/:matchId/edit", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const { router } = renderApp("/matches/match-1/edit");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/matches/match-1/edit");
    });
  });

  it("renders held events at /held-events for authenticated users", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const { router } = renderApp("/held-events");

    expect(await screen.findByRole("heading", { name: "開催履歴" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/held-events");
    expect(screen.getByRole("link", { name: "開催" })).toBeInTheDocument();
  });

  it("renders standings comparison at /analytics/series for authenticated users", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const { router } = renderApp("/analytics/series");

    expect(await screen.findByRole("heading", { name: "戦績比較" })).toBeInTheDocument();
    expect(await screen.findByText("順位差")).toBeInTheDocument();
    expect(await screen.findByText("銀次被害")).toBeInTheDocument();
    expect(screen.queryByText("集計対象")).not.toBeInTheDocument();
    expect(screen.queryByText("データ注意")).not.toBeInTheDocument();
    expect(await screen.findByText("条件付き指標があります。")).toBeInTheDocument();
    const reviewTab = screen.getByRole("tab", { name: "振り返り" });
    expect(reviewTab).toHaveAttribute("aria-selected", "true");
    expect(reviewTab).toHaveAttribute("aria-controls", "series-comparison-view-review");
    expect(screen.getByRole("tabpanel", { name: "振り返り" })).toHaveAttribute(
      "aria-labelledby",
      "series-comparison-tab-review",
    );
    expect(await screen.findByRole("heading", { name: "行動プレイブック" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "行動プレイブック" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今回の要点" })).not.toBeInTheDocument();
    expect(screen.queryByText(/次回へ持ち越す論点/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "流れと勢いで根拠を見る" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "4試合の流れ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "この回の見立て" })).not.toBeInTheDocument();
    expect(screen.getByText("分析範囲")).toBeInTheDocument();
    expect(screen.getByText("総合 / 12戦")).toBeInTheDocument();
    expect(screen.getByText("卓全体で出やすい論点")).toBeInTheDocument();
    expect(screen.getByText("収益先行後の勝ち切りが共通論点です")).toBeInTheDocument();
    expect(screen.queryByText("読み取り")).not.toBeInTheDocument();
    expect(screen.queryByText("次回の確認")).not.toBeInTheDocument();
    expect(screen.queryByText("根拠あり")).not.toBeInTheDocument();
    expect(screen.queryByText(/カード内/u)).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "次回も収益で上回った試合を拾い、勝てた試合と落とした試合で目的地回数や事故の差が出ているかを見ます。",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "対象" })).not.toBeInTheDocument();
    expect(screen.queryByText("member_eu")).not.toBeInTheDocument();
    expect(screen.queryByText("member_otaka")).not.toBeInTheDocument();
    expect(screen.queryByText("revenue")).not.toBeInTheDocument();
    expect(screen.queryByText("play_order")).not.toBeInTheDocument();
    expect(screen.queryByText("直す")).not.toBeInTheDocument();
    expect(screen.queryByText("直近の下振れを確認する")).not.toBeInTheDocument();
    const evidenceButtons = screen.getAllByRole("button", { name: "詳細: 物件収益と勝ちへ" });
    await user.click(evidenceButtons[0]!);
    await waitFor(() => expect(router.state.location.search).toContain("view=drivers"));
    expect(
      await screen.findByRole("heading", { name: "物件収益トップを勝ちにできたか" }),
    ).toBeInTheDocument();
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "振り返り" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(await screen.findByRole("heading", { name: "行動プレイブック" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "平均順位の推移グラフ" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "順位と相性" }));

    expect(await screen.findByRole("img", { name: "平均順位の推移グラフ" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "安定性" })).toHaveAttribute("href", "#metric-rate");
    expect(screen.queryByRole("heading", { name: "総資産と勝ち筋" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "物件収益トップを勝ちにできたか" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "勝ち筋" }));

    expect(await screen.findByRole("heading", { name: "総資産と勝ち筋" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "資産と勝ち筋" })).toHaveAttribute(
      "href",
      "#metric-money",
    );
    expect(screen.queryByRole("link", { name: "桃鉄/遊戯王" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "物件収益額" })).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "桃鉄型 / 遊戯王型の根拠" }),
    ).toBeInTheDocument();
    expect(screen.getByText("強調ルール")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "物件収益分布" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "物件収益トップを勝ちにできたか" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "目的地到着を勝ちにできたか" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "物件収益と勝ち" })).toHaveAttribute(
      "href",
      "#metric-revenue-outcome",
    );
    expect(screen.getByRole("link", { name: "目的地と勝ち" })).toHaveAttribute(
      "href",
      "#metric-destination-outcome",
    );
    expect(router.state.location.search).toContain("view=drivers");

    await user.click(screen.getByRole("tab", { name: "流れと勢い" }));

    expect(screen.getByRole("link", { name: "期間内の荒れ" })).toHaveAttribute(
      "href",
      "#metric-match-digest",
    );
    expect(await screen.findByRole("heading", { name: "期間内の荒れ試合" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第n試合傾向" })).toHaveAttribute(
      "href",
      "#metric-match-no",
    );
    expect(await screen.findByRole("heading", { name: "第n試合の傾向" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "番手と出来事" }));

    expect(screen.getByRole("link", { name: "番手" })).toHaveAttribute(
      "href",
      "#metric-play-order",
    );
    expect(screen.getByRole("link", { name: "売り場×目的地" })).toHaveAttribute(
      "href",
      "#metric-card-shop-destination",
    );
    expect(screen.getByRole("link", { name: "スリの銀次" })).toHaveAttribute(
      "href",
      "#metric-ginji",
    );
    expect(
      await screen.findByRole("heading", { name: "カード売り場と目的地" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "安定性" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { name: "いーゆー" })).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "収益と目的地の効き方" })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/analytics/series");
    expect(screen.getByRole("link", { name: "戦績比較" })).toBeInTheDocument();
  });

  it("requests standings comparison with season and map filters together", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const aggregateSearches: string[] = [];
    server.use(
      http.get("/api/analytics/series-comparison", ({ request }) => {
        aggregateSearches.push(new URL(request.url).search);
        return HttpResponse.json(makeSeriesComparisonResponse());
      }),
    );
    const { router } = renderApp("/analytics/series");

    expect(await screen.findByRole("heading", { name: "戦績比較" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "シーズン" }), "season_current");
    await user.selectOptions(screen.getByRole("combobox", { name: "マップ" }), "map_east");

    await waitFor(() => {
      expect(router.state.location.search).toContain("seasonMasterId=season_current");
      expect(router.state.location.search).toContain("mapMasterId=map_east");
      expect(
        aggregateSearches.some(
          (search) =>
            search.includes("seasonMasterId=season_current") &&
            search.includes("mapMasterId=map_east"),
        ),
      ).toBe(true);
    });
  });

  it("does not show an empty standings state when comparison options fail to load", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    server.use(
      http.get("/api/analytics/series-comparison/options", () =>
        HttpResponse.json({ detail: "failed" }, { status: 500 }),
      ),
    );

    renderApp("/analytics/series");

    expect(await screen.findByText("対象作品を読み込めません")).toBeInTheDocument();
    expect(screen.queryByText("比較できる戦績がありません")).not.toBeInTheDocument();
  });
});
