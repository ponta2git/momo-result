import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import {
  createMemoryRouter,
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  useLocation,
} from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { HeldEventDetailPage } from "@/features/heldEvents/HeldEventDetailPage";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeHeldEventDetailResponse } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function renderPage() {
  setDevUser();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/held-events/held-1"]}>
        <Routes>
          <Route element={<HeldEventDetailPage />} path="/held-events/:heldEventId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="現在のURL">{`${location.pathname}${location.search}${location.hash}`}</output>
  );
}

function renderNavigationPage(path: string) {
  setDevUser();
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <LocationProbe />
            <Outlet />
          </>
        ),
        children: [
          { path: "/held-events/:heldEventId", element: <HeldEventDetailPage /> },
          { path: "/held-events", element: <p>開催履歴の起点</p> },
          { path: "/matches/:matchId", element: <p>試合結果の起点</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("HeldEventDetailPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("moves across events while retaining the original conditions and current action targets", async () => {
    const events = [
      { id: "held-1", heldAt: "2026-01-01T00:00:00.000Z" },
      { id: "held-2", heldAt: "2026-01-02T00:00:00.000Z" },
      { id: "held-3", heldAt: "2026-01-03T00:00:00.000Z" },
    ];
    server.use(
      http.get("/api/held-events/:heldEventId", ({ params }) => {
        const index = events.findIndex((event) => event.id === params["heldEventId"]);
        const current = events[index];
        if (!current) return HttpResponse.json({ code: "NOT_FOUND" }, { status: 404 });
        const previous = events[index - 1];
        const next = events[index + 1];
        return HttpResponse.json(
          makeHeldEventDetailResponse({
            ...current,
            nextMatchNo: index + 2,
            navigation: { ...(previous ? { previous } : {}), ...(next ? { next } : {}) },
          }),
        );
      }),
    );
    const origin = "/held-events?page=2&pageSize=5#records";
    const router = renderNavigationPage(withReturnTo("/held-events/held-1", origin));

    await user.click(await screen.findByRole("link", { name: /次の開催/u }));
    const secondUrl = withReturnTo("/held-events/held-2", origin);
    expect(await screen.findByRole("heading", { name: "2026/01/02 09:00" })).toHaveFocus();
    expect(screen.getByLabelText("現在のURL")).toHaveTextContent(secondUrl);
    expect(screen.getByRole("link", { name: "手入力" })).toHaveAttribute(
      "href",
      withReturnTo("/matches/new?heldEventId=held-2", secondUrl),
    );
    expect(screen.getByRole("link", { name: "CSV出力" })).toHaveAttribute(
      "href",
      withReturnTo("/exports?heldEventId=held-2&format=csv", secondUrl),
    );
    await user.click(screen.getByRole("link", { name: /次の開催/u }));
    expect(await screen.findByRole("heading", { name: "2026/01/03 09:00" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /次の開催/u })).not.toBeInTheDocument();
    expect(screen.getByText("最後の開催です")).toBeInTheDocument();
    await act(async () => {
      await router.navigate(-1);
    });
    expect(await screen.findByRole("heading", { name: "2026/01/02 09:00" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "開催履歴へ戻る" }));
    expect(screen.getByLabelText("現在のURL")).toHaveTextContent(origin);
    expect(screen.getByText("開催履歴の起点")).toBeInTheDocument();
  });

  it("keeps a legacy response readable without claiming it has no neighboring events", async () => {
    const legacy = makeHeldEventDetailResponse();
    const { navigation: _navigation, ...legacyBody } = legacy;
    let restored = false;
    server.use(
      http.get("/api/held-events/:heldEventId", () =>
        HttpResponse.json(
          restored
            ? makeHeldEventDetailResponse({
                navigation: { next: { id: "held-2", heldAt: "2026-01-02T00:00:00Z" } },
              })
            : legacyBody,
        ),
      ),
    );
    renderNavigationPage(withReturnTo("/held-events/held-1", "/matches/match-1#note"));
    expect(await screen.findByText(/前後の開催を利用できません/u)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "試合結果へ戻る" })).toHaveAttribute(
      "href",
      "/matches/match-1#note",
    );
    expect(screen.getByRole("link", { name: "手入力" })).toBeInTheDocument();
    expect(screen.queryByText("最初の開催です")).not.toBeInTheDocument();
    restored = true;
    await user.click(screen.getByRole("button", { name: "前後の開催を再取得" }));
    expect(await screen.findByRole("link", { name: /次の開催/u })).toHaveAttribute(
      "href",
      withReturnTo("/held-events/held-2", "/matches/match-1#note"),
    );
  });

  it("does not expose old neighbors while an invalidated inactive detail is revalidated", async () => {
    const gate = createDeferred();
    let changed = false;
    server.use(
      http.get("/api/held-events/:heldEventId", async () => {
        if (changed) await gate.promise;
        return HttpResponse.json(
          makeHeldEventDetailResponse({
            navigation: {
              next: {
                id: changed ? "held-new" : "held-old",
                heldAt: "2026-01-02T00:00:00Z",
              },
            },
          }),
        );
      }),
    );
    const router = renderNavigationPage("/held-events/held-1");
    expect(await screen.findByRole("link", { name: /次の開催/u })).toHaveAttribute(
      "href",
      "/held-events/held-old",
    );
    await user.click(screen.getByRole("link", { name: "開催履歴へ戻る" }));
    changed = true;
    await queryClient.invalidateQueries({ queryKey: heldEventKeys.detail("held-1") });
    await act(async () => {
      await router.navigate("/held-events/held-1");
    });
    const paused = await screen.findByRole("link", { name: /次の開催/u });
    expect(paused).toHaveAttribute("aria-disabled", "true");
    expect(paused).not.toHaveAttribute("href");
    expect(screen.getByRole("link", { name: "手入力" })).toBeInTheDocument();
    await user.click(paused);
    expect(screen.getByLabelText("現在のURL")).toHaveTextContent("/held-events/held-1");
    await act(async () => {
      gate.resolve();
    });
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /次の開催/u })).toHaveAttribute(
        "href",
        "/held-events/held-new",
      ),
    );
  });

  it("keeps a confirmed missing event missing on revisit and only restores a successful read", async () => {
    let phase: "available" | "missing" | "outage" = "available";
    server.use(
      http.get("/api/held-events/:heldEventId", () => {
        if (phase === "missing")
          return HttpResponse.json(
            {
              type: "about:blank",
              title: "Not Found",
              status: 404,
              code: "NOT_FOUND",
              detail: "missing event",
            },
            { status: 404 },
          );
        if (phase === "outage")
          return HttpResponse.json({ detail: "unavailable" }, { status: 500 });
        return HttpResponse.json(
          makeHeldEventDetailResponse({
            navigation: {
              next: { id: "held-2", heldAt: "2026-01-02T00:00:00Z" },
            },
          }),
        );
      }),
    );
    const path = withReturnTo("/held-events/held-1", "/matches/match-1#note");
    const router = renderNavigationPage(path);
    expect(await screen.findByRole("link", { name: /次の開催/u })).toBeInTheDocument();
    phase = "missing";
    await user.click(screen.getByRole("button", { name: "開催詳細を更新" }));
    expect(
      await screen.findByRole("heading", { name: "開催が見つかりません" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "試合結果へ戻る" })).toHaveAttribute(
      "href",
      "/matches/match-1#note",
    );
    const recoveryActions = within(screen.getByRole("navigation", { name: "この開催の関連操作" }));
    await user.click(recoveryActions.getByRole("link", { name: "開催履歴を開く" }));
    phase = "outage";
    await queryClient.invalidateQueries({ queryKey: heldEventKeys.detail("held-1") });
    await act(async () => {
      await router.navigate(path);
    });
    await waitFor(() =>
      expect(queryClient.getQueryState(heldEventKeys.detail("held-1"))?.fetchStatus).toBe("idle"),
    );
    expect(screen.getByRole("heading", { name: "開催が見つかりません" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /次の開催/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "手入力" })).not.toBeInTheDocument();
    phase = "available";
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: heldEventKeys.detail("held-1") });
    });
    expect(await screen.findByRole("link", { name: /次の開催/u })).toBeInTheDocument();
  });

  it.each([
    [
      "/held-events/held-1?different=condition#part",
      "戻り先が現在の開催のため、開催履歴へ戻ります。",
    ],
    ["https://outside.example/", "戻り先が無効なため、開催履歴へ戻ります。"],
  ])("recovers from an unusable return destination %s", async (returnTo, notice) => {
    renderNavigationPage(`/held-events/held-1?returnTo=${encodeURIComponent(returnTo)}`);
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開催履歴へ戻る" })).toHaveAttribute(
      "href",
      "/held-events",
    );
  });

  it("connects one held event to its draft, player recap, results, and comparison", async () => {
    server.use(
      http.get("/api/held-events/:heldEventId", () =>
        HttpResponse.json(
          makeHeldEventDetailResponse({
            draftCount: 2,
            drafts: [
              {
                gameTitleId: "gt_momotetsu_2",
                mapMasterId: "map_east",
                matchDraftId: "draft-review-1",
                matchNoInEvent: 2,
                seasonMasterId: "season_current",
                status: "needs_review",
                updatedAt: "2026-01-01T01:00:00.000Z",
              },
              {
                matchDraftId: "draft-manual-2",
                matchNoInEvent: 3,
                status: "ocr_failed",
                updatedAt: "2026-01-01T02:00:00.000Z",
              },
            ],
            matchCount: 1,
            matches: [
              {
                gameTitleId: "gt_momotetsu_2",
                mapMasterId: "map_east",
                matchId: "match-1",
                matchNoInEvent: 1,
                noteBody: "終盤のカード交換で流れが変わった",
                ownerMemberId: "member_ponta",
                playedAt: "2026-01-01T00:00:00.000Z",
                players: [
                  {
                    memberId: "member_ponta",
                    playOrder: 1,
                    rank: 2,
                    revenueManYen: 100,
                    totalAssetsManYen: 12_345,
                  },
                  {
                    memberId: "member_eu",
                    playOrder: 2,
                    rank: 1,
                    revenueManYen: 90,
                    totalAssetsManYen: 9_000,
                  },
                ],
                seasonMasterId: "season_current",
              },
            ],
            nextMatchNo: 4,
          }),
        ),
      ),
    );

    renderPage();

    expect(await screen.findByRole("heading", { name: "この開催の戦績" })).toBeInTheDocument();
    expect(screen.getByText("確定済み1試合・未確定下書き2件")).toBeInTheDocument();
    expect(await screen.findAllByText("桃太郎電鉄2・今シーズン・東日本編")).toHaveLength(2);
    const primaryDraftAction = screen.getByRole("link", { name: "確認事項を直す" });
    expect(primaryDraftAction).toHaveAttribute(
      "href",
      "/review/draft-review-1?returnTo=%2Fheld-events%2Fheld-1",
    );
    expect(screen.getByRole("link", { name: "手入力で続ける" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OCR取り込み" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "手入力" })).toBeInTheDocument();
    const results = screen.getByRole("list", { name: "第1試合の順位と総資産" });
    expect(within(results).getByText("1億2345万円")).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "試合メモ" })).toHaveTextContent(
      "終盤のカード交換で流れが変わった",
    );
    expect(screen.getByText("終盤のカード交換で流れが変わった")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第1試合の結果を見る" })).toHaveAttribute(
      "href",
      "/matches/match-1?returnTo=%2Fheld-events%2Fheld-1",
    );
    expect(screen.getByRole("link", { name: "第1試合を戦績比較で見る" })).toHaveAttribute(
      "href",
      "/analytics/series?gameTitleId=gt_momotetsu_2&seasonMasterId=season_current&mapMasterId=map_east&focusMatchId=match-1&view=flow&returnTo=%2Fheld-events%2Fheld-1",
    );
    expect(
      screen.queryByRole("link", { name: /試合検索で見る|の試合を検索$/u }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "第4試合を記録" })).toBeInTheDocument();
  });

  it("offers event-scoped capture actions before the first confirmed match", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "確定済みの試合はまだありません" }),
    ).toBeInTheDocument();
    const ocrLink = await screen.findByRole("link", { name: "OCR取り込み" });
    expect(ocrLink).toHaveAttribute(
      "href",
      "/ocr/new?heldEventId=held-1&returnTo=%2Fheld-events%2Fheld-1",
    );
    const manualLink = screen.getByRole("link", { name: "手入力" });
    expect(manualLink).toHaveAttribute(
      "href",
      "/matches/new?heldEventId=held-1&returnTo=%2Fheld-events%2Fheld-1",
    );
  });

  it("distinguishes a missing event from a transient load failure", async () => {
    server.use(
      http.get("/api/held-events/:heldEventId", () =>
        HttpResponse.json(
          {
            code: "NOT_FOUND",
            detail: "held event not found",
            status: 404,
            title: "Not Found",
            type: "about:blank",
          },
          { status: 404 },
        ),
      ),
    );

    renderPage();

    await screen.findByRole("heading", {
      level: 1,
      name: "開催が見つかりません",
    });
    expect(
      screen.queryByRole("link", { name: /試合検索で見る|の試合を検索$/u }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CSV出力" })).toHaveAttribute(
      "href",
      "/exports?heldEventId=held-1&format=csv&returnTo=%2Fheld-events%2Fheld-1",
    );
    expect(screen.getByRole("link", { name: "開催履歴へ戻る" })).toHaveAttribute(
      "href",
      "/held-events",
    );
    expect(screen.queryByRole("button", { name: "開催詳細を再読み込み" })).not.toBeInTheDocument();
  });

  it("retries a transient held-event detail failure in place", async () => {
    let attempts = 0;
    server.use(
      http.get("/api/held-events/:heldEventId", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json(makeHeldEventDetailResponse());
      }),
    );

    renderPage();

    await screen.findByRole("heading", {
      level: 1,
      name: "開催詳細を読み込めませんでした",
    });
    await user.click(screen.getByRole("button", { name: "開催詳細を再読み込み" }));

    expect(
      await screen.findByRole("heading", { name: "確定済みの試合はまだありません" }),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("retains the detail and its safe operations when a manual refresh fails", async () => {
    let attempts = 0;
    server.use(
      http.get("/api/held-events/:heldEventId", () => {
        attempts += 1;
        return attempts === 2
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json(makeHeldEventDetailResponse());
      }),
    );

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "確定済みの試合はまだありません" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "開催詳細を更新" }));

    expect(await screen.findByText("開催詳細を更新できませんでした")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "確定済みの試合はまだありません" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OCR取り込み" })).toHaveAttribute(
      "href",
      "/ocr/new?heldEventId=held-1&returnTo=%2Fheld-events%2Fheld-1",
    );

    await user.click(screen.getByRole("button", { name: "開催詳細を再取得" }));

    await waitFor(() =>
      expect(screen.queryByText("開催詳細を更新できませんでした")).not.toBeInTheDocument(),
    );
    expect(attempts).toBe(3);
  });

  it("replaces stale detail with the deleted state when a refresh confirms a 404", async () => {
    let attempts = 0;
    server.use(
      http.get("/api/held-events/:heldEventId", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json(makeHeldEventDetailResponse())
          : HttpResponse.json(
              {
                code: "NOT_FOUND",
                detail: "held event not found",
                status: 404,
                title: "Not Found",
                type: "about:blank",
              },
              { status: 404 },
            );
      }),
    );

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "確定済みの試合はまだありません" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "開催詳細を更新" }));

    expect(await screen.findByText("開催が見つかりません")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "OCR取り込み" })).not.toBeInTheDocument();
  });

  it("uses snapshot labels without loading unrelated master directories", async () => {
    const extraRequests: string[] = [];
    server.use(
      ...["game-titles", "season-masters", "map-masters"].map((resource) =>
        http.get(`/api/${resource}`, () => {
          extraRequests.push(resource);
          return HttpResponse.json({ detail: "unavailable" }, { status: 500 });
        }),
      ),
      http.get("/api/held-events/:heldEventId", () =>
        HttpResponse.json(
          makeHeldEventDetailResponse({
            matchCount: 1,
            matches: [
              {
                gameTitleId: "gt_momotetsu_2",
                gameTitleName: "対象作品",
                mapMasterId: "map_east",
                mapName: "対象マップ",
                seasonMasterId: "season_current",
                seasonName: "対象シーズン",
                matchId: "match-1",
                matchNoInEvent: 1,
                ownerMemberId: "member_ponta",
                playedAt: "2026-01-01T00:00:00.000Z",
                players: [],
              },
            ],
          }),
        ),
      ),
    );
    renderPage();
    expect(await screen.findByText("対象作品・対象シーズン・対象マップ")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第1試合の結果を見る" })).toBeInTheDocument();
    expect(extraRequests).toEqual([]);
  });
});
