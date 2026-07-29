import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

  it("renders standings comparison at /analytics/series for authenticated users", async () => {
    setDevUser();
    const { router } = renderApp("/analytics/series");

    expect(await screen.findByRole("heading", { name: "戦績比較" })).toBeInTheDocument();
    expect(await screen.findByText(/12戦 ・ (読み取り目安|参考)/u)).toBeInTheDocument();
    expect(screen.queryByText("順位差")).not.toBeInTheDocument();
    expect(screen.queryByText("銀次被害")).not.toBeInTheDocument();
    expect(screen.queryByText("集計対象")).not.toBeInTheDocument();
    expect(screen.queryByText("データ注意")).not.toBeInTheDocument();
    expect(screen.queryByText("条件付き指標があります。")).not.toBeInTheDocument();
    const reviewTab = await screen.findByRole("tab", { name: "次戦に備える" });
    expect(reviewTab).toHaveAttribute("aria-selected", "true");
    expect(reviewTab).toHaveAttribute("aria-controls", "series-comparison-purpose-panel-review");
    expect(screen.getByRole("tabpanel", { name: "次戦に備える" })).toHaveAttribute(
      "aria-labelledby",
      "series-comparison-purpose-tab-review",
    );
    expect(await screen.findByRole("region", { name: "次戦の行動仮説" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "行動プレイブック" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今回の要点" })).not.toBeInTheDocument();
    expect(screen.queryByText(/次回へ持ち越す論点/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "流れと勢いで根拠を見る" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "4試合の流れ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "この回の見立て" })).not.toBeInTheDocument();
    expect(screen.queryByText("分析範囲")).not.toBeInTheDocument();
    expect(screen.queryByText("総合 / 12戦")).not.toBeInTheDocument();
    const guideButton = screen.getByRole("button", { name: "分類と信頼度の読み方" });
    expect(guideButton).toHaveAttribute("aria-haspopup", "dialog");
    const commonTopicToggle = screen.getByRole("button", { name: "卓全体の共通論点" });
    expect(commonTopicToggle).toHaveAttribute("aria-expanded", "false");
    expect(commonTopicToggle).toHaveTextContent("収益先行後の勝ち切り");
    expect(commonTopicToggle).not.toHaveTextContent("重複候補");
    expect(commonTopicToggle).not.toHaveTextContent("まとめて");
    expect(screen.queryByText("収益先行後の勝ち切りが共通論点です")).not.toBeInTheDocument();
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
    await user.click(guideButton);
    const guideDialog = await screen.findByRole("dialog", {
      name: "分類と信頼度の読み方",
    });
    expect(within(guideDialog).getByRole("heading", { name: "分類" })).toBeInTheDocument();
    expect(within(guideDialog).getByRole("heading", { name: "信頼度" })).toBeInTheDocument();
    await user.click(
      within(guideDialog).getByRole("button", {
        name: "ダイアログを閉じる",
      }),
    );
    await user.click(commonTopicToggle);
    expect(commonTopicToggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("収益先行後の勝ち切りが共通論点です")).toBeInTheDocument();
    expect(
      screen.getByText(
        "収益で上回った試合は、目的地到着、事故後の入賞維持、終盤の下位回避のどれが順位差に近いかを振り返ります。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("複数人に出た候補はここにまとめ")).not.toBeInTheDocument();
    expect(screen.queryByText(/収益トップだから安全/u)).not.toBeInTheDocument();
    const detailToggles = screen.getAllByRole("button", {
      name: "根拠・注意・試合後の確認",
    });
    expect(detailToggles[0]).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(detailToggles[0]!);
    const detailsDialog = await screen.findByRole("dialog", {
      name: "行動仮説の根拠と確認",
    });
    expect(within(detailsDialog).getByText(/収益トップだから安全/u)).toBeInTheDocument();
    expect(within(detailsDialog).getByText(/物件収益トップ時の1位率は57.1%/u)).toBeInTheDocument();
    expect(within(detailsDialog).getByText("物件収益トップ時の1位率")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "収益で先行した試合でも、目的地到着や事故後の立て直しで順位差が分かれています。",
      )[0],
    ).toBeInTheDocument();
    expect(screen.queryByText("Cliff's delta")).not.toBeInTheDocument();
    expect(screen.queryByText("confidence interval")).not.toBeInTheDocument();
    expect(screen.queryByText("bootstrap")).not.toBeInTheDocument();
    expect(within(detailsDialog).getByText("本人全体の1位率")).toBeInTheDocument();
    expect(within(detailsDialog).getByText(/差の大きさ \+0.62/u)).toBeInTheDocument();
    expect(within(detailsDialog).getByText(/ぶれ幅 \+0.31〜\+0.84/u)).toBeInTheDocument();
    await user.click(
      within(detailsDialog).getByRole("button", {
        name: "ダイアログを閉じる",
      }),
    );
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
      expect(screen.getByRole("tab", { name: "次戦に備える" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(await screen.findByRole("region", { name: "次戦の行動仮説" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "平均順位の推移グラフ" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "分析する" }));

    expect(await screen.findByRole("img", { name: "平均順位の推移グラフ" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "今の差" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("link", { name: "安定性" })).toHaveAttribute("href", "#metric-rate");
    expect(screen.queryByRole("heading", { name: "総資産と勝ち筋" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "物件収益トップを勝ちにできたか" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "勝因候補" }));

    expect(await screen.findByRole("heading", { name: "総資産と勝ち筋" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "資産と勝ち筋" })).toHaveAttribute(
      "href",
      "#metric-money",
    );
    expect(screen.queryByRole("link", { name: "桃鉄/遊戯王" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "物件収益額" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "稼ぎ方の比重の根拠" })).toBeInTheDocument();
    expect(screen.getAllByText("総資産の出方")).toHaveLength(4);
    expect(screen.getAllByText("稼ぎ方の比重")).toHaveLength(4);
    expect(screen.getByText("桃鉄型（物件重視）")).toBeInTheDocument();
    expect(screen.getByText("遊戯王型（カード重視）")).toBeInTheDocument();
    expect(screen.queryByText("総資産の型")).not.toBeInTheDocument();
    expect(screen.queryByText("物件/カード軸")).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("tab", { name: "推移" }));

    expect(screen.getByRole("link", { name: "期間内の荒れ" })).toHaveAttribute(
      "href",
      "#metric-match-digest",
    );
    expect(await screen.findByRole("heading", { name: "期間内の荒れ試合" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1戦目の試合結果を見る" })).toHaveAttribute(
      "href",
      "/matches/match-1",
    );
    expect(screen.getByRole("link", { name: "第n試合傾向" })).toHaveAttribute(
      "href",
      "#metric-match-no",
    );
    expect(await screen.findByRole("heading", { name: "第n試合の傾向" })).toBeInTheDocument();
    expect(screen.queryByText(/第5試合以降は折りたたみます/u)).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "条件別" }));

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
  }, 10_000);

  it("keeps a result-page match as context without changing the aggregate scope", async () => {
    setDevUser();
    const aggregateSearches: string[] = [];
    server.use(
      http.get("/api/analytics/series-comparison", ({ request }) => {
        aggregateSearches.push(new URL(request.url).search);
        return HttpResponse.json(makeSeriesComparisonResponse());
      }),
    );
    const { router } = renderApp(
      "/analytics/series?gameTitleId=gt_momotetsu_2&seasonMasterId=season_current&mapMasterId=map_east&focusMatchId=match-12&view=flow",
    );

    const focusedMatch = await screen.findByRole("region", { name: "選択中の試合" });
    expect(within(focusedMatch).getByRole("heading", { name: /12戦目/u })).toBeInTheDocument();
    expect(
      within(focusedMatch).getByRole("list", { name: "選択中の試合の順位と成績" }),
    ).toBeInTheDocument();
    expect(within(focusedMatch).getByRole("link", { name: "この試合の結果" })).toHaveAttribute(
      "href",
      "/matches/match-12",
    );
    expect(screen.getByRole("tab", { name: "分析する" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "推移" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('[data-focused-metric="true"]').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/この試合に該当/u)).toHaveLength(4);
    expect(aggregateSearches).not.toHaveLength(0);
    expect(aggregateSearches.every((search) => !search.includes("focusMatchId"))).toBe(true);

    await user.click(screen.getByRole("tab", { name: "勝因候補" }));
    expect(router.state.location.search).toContain("focusMatchId=match-12");
    await screen.findByRole("img", { name: "物件収益比率と総資産の散布図" });
    expect(document.querySelectorAll('[data-focused-match="true"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-focused-metric="true"]').length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: /この試合に該当/u })).toHaveLength(4);

    await user.click(screen.getByRole("tab", { name: "今の差" }));
    expect(await screen.findByRole("heading", { name: "順位の地力" })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-focused-metric="true"]')).toHaveLength(4);

    await user.click(within(focusedMatch).getByRole("button", { name: "選択解除" }));

    await waitFor(() => {
      expect(router.state.location.search).not.toContain("focusMatchId");
      expect(screen.queryByRole("region", { name: "選択中の試合" })).not.toBeInTheDocument();
      expect(document.querySelectorAll('[data-focused-match="true"]')).toHaveLength(0);
      expect(document.querySelectorAll('[data-focused-metric="true"]')).toHaveLength(0);
    });
  });

  it("opens rank average history drilldown from the standings overview", async () => {
    setDevUser();
    renderApp("/analytics/series");

    await screen.findByRole("heading", { name: "戦績比較" });
    await user.click(await screen.findByRole("tab", { name: "分析する" }));
    expect(await screen.findByRole("heading", { name: "順位の地力" })).toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "履歴" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "履歴" }));

    const dialog = await screen.findByRole("dialog", { name: "順位の地力: いーゆー" });
    expect(dialog).toHaveTextContent("現在の平均順位");
    expect(dialog).toHaveTextContent("直近開催の平均変化");
    expect(dialog).toHaveTextContent("0.25 改善");
    expect(dialog).not.toHaveTextContent("初戦後から");
    expect(dialog).not.toHaveTextContent("現在平均 - 初戦後平均");
    expect(dialog).not.toHaveTextContent("状態");
    expect(dialog).not.toHaveTextContent("データ信頼度");
    expect(dialog).toHaveTextContent("開催による変動");
    expect(within(dialog).getByLabelText("開催ごとの順位履歴")).toHaveClass("overflow-auto");
    expect(within(dialog).getAllByRole("row")[1]).toHaveTextContent("1位 → 3位");

    await user.click(screen.getByRole("button", { name: "試合ごと" }));

    expect(dialog).toHaveTextContent("試合後平均順位");
    expect(within(dialog).getByLabelText("試合ごとの順位履歴")).toHaveClass("overflow-auto");
    expect(within(dialog).getAllByRole("row")[1]).toHaveTextContent("4戦目");
    expect(within(dialog).getByRole("link", { name: "4戦目の試合結果を見る" })).toHaveAttribute(
      "href",
      "/matches/match-4",
    );
    expect(dialog).toHaveTextContent("2戦目");
    expect(dialog).toHaveTextContent("3位 改善");
  });

  it("opens play order rank history drilldown from play order metrics", async () => {
    setDevUser();
    renderApp("/analytics/series");

    await screen.findByRole("heading", { name: "戦績比較" });
    await user.click(await screen.findByRole("tab", { name: "分析する" }));
    await user.click(await screen.findByRole("tab", { name: "条件別" }));
    expect(await screen.findByRole("heading", { name: "番手別成績" })).toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "履歴" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "履歴" }));

    const dialog = await screen.findByRole("dialog", { name: "番手別成績: いーゆー" });
    expect(dialog).toHaveTextContent("良かった番手");
    expect(dialog).toHaveTextContent("1P 平均1.50");
    expect(dialog).toHaveTextContent("重かった番手");
    expect(dialog).toHaveTextContent("3P 平均4.00");
    expect(dialog).toHaveTextContent("番手別件数");
    expect(dialog).toHaveTextContent("1P 2戦 / 2P 2戦 / 3P 1戦 / 4P 0戦");
    expect(
      within(dialog).getByRole("img", { name: "番手別累積平均順位グラフ" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "開催ごと" })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("img", { name: "番手別実順位グラフ" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("番手別平均順位推移の実データ")).toHaveClass(
      "overflow-auto",
    );
    expect(within(dialog).getAllByRole("row")[1]).toHaveTextContent("5戦目");
    expect(within(dialog).getByRole("link", { name: "5戦目の試合結果を見る" })).toHaveAttribute(
      "href",
      "/matches/play-order-match-5",
    );
    expect(within(dialog).getAllByRole("row")[1]).toHaveTextContent("2P");
    expect(within(dialog).getAllByRole("row")[1]).toHaveTextContent("2戦目");
    expect(dialog).toHaveTextContent("1.00 改善");

    await user.click(within(dialog).getByRole("button", { name: "番手別集計" }));
    expect(within(dialog).getByLabelText("番手ごとの成績履歴")).toHaveClass("overflow-auto");
    expect(dialog).toHaveTextContent("全体平均との差");
    expect(dialog).toHaveTextContent("0.50 重い");
  });

  it("requests standings comparison with season and map filters together", async () => {
    setDevUser();
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
    setDevUser();
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
