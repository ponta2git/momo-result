import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MatchDetailPage } from "@/features/matches/MatchDetailPage";
import { matchKeys } from "@/shared/api/queryKeys";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import {
  makeFourPlayerResults,
  makeHeldEventResponse,
  makeIncidents,
  makeMatchDetail,
} from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  analysisArtifact,
  makeSeriesAnalysisMatchContext,
  makeSeriesAnalysisStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

let user: ReturnType<typeof userEvent.setup>;

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

function GlobalNavigationButton({ destination = "/other" }: { destination?: string }) {
  const navigate = useNavigate();
  return (
    <button data-testid="leave-match-detail" type="button" onClick={() => navigate(destination)}>
      leave detail
    </button>
  );
}

async function dispatchPassiveRefreshSignals() {
  vi.useFakeTimers();
  try {
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    });
  } finally {
    vi.useRealTimers();
  }
}

describe("MatchDetailPage", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("exposes result navigation and confirms deletion before acting", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
            <Route path="/matches" element={<p>list</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前後の戦績を見る" })).toHaveAttribute(
      "href",
      "/analytics/series?gameTitleId=gt_momotetsu_2&seasonMasterId=season_current&mapMasterId=map_east&focusMatchId=match-1&view=flow&returnTo=%2Fmatches%2Fmatch-1",
    );
    expect(screen.getByRole("link", { name: "この開催へ戻る" })).toHaveAttribute(
      "href",
      "/held-events/held-1",
    );

    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByRole("heading", { name: "試合を削除しますか？" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除する" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "試合を削除しますか？" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("groups note edit and delete as one accessible action set", async () => {
    setDevUser();
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json(
          makeMatchDetail({
            note: {
              body: "終盤のカード交換で流れが変わった",
              updatedAt: "2026-04-04T13:10:00.000Z",
              updatedByDisplayName: "ぽんた",
              version: "1",
            },
          }),
        ),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const noteSection = await screen.findByRole("region", { name: "試合メモ" });
    const actions = within(noteSection).getByRole("group", { name: "試合メモの操作" });
    const edit = within(actions).getByRole("button", { name: "編集" });
    const remove = within(actions).getByRole("button", { name: "メモを削除" });

    expect(edit).toBeEnabled();
    expect(remove).toBeEnabled();
    expect(within(noteSection).getAllByRole("button", { name: "メモを削除" })).toHaveLength(1);
  });

  it("keeps a failed delete in the dialog and allows retrying it", async () => {
    setDevUser();
    let deleteAttempts = 0;
    server.use(
      http.delete("/api/matches/:matchId", ({ params }) => {
        deleteAttempts += 1;
        if (deleteAttempts === 1) {
          return HttpResponse.json(
            {
              code: "INTERNAL_ERROR",
              detail: "delete failed",
              status: 500,
              title: "Delete failed",
              type: "about:blank",
            },
            { status: 500 },
          );
        }
        return HttpResponse.json({ deleted: true, matchId: params["matchId"] });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
            <Route path="/held-events/:heldEventId" element={<p>held-event-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "予期しないエラーが発生しました。もう一度お試しください。",
    );
    expect(screen.getByRole("heading", { name: "試合を削除しますか？" })).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "削除する" });
    expect(retry).toBeEnabled();

    await user.click(retry);

    expect(await screen.findByText("held-event-page")).toBeInTheDocument();
    expect(deleteAttempts).toBe(2);
    expect(screen.queryByRole("heading", { name: "試合を削除しますか？" })).not.toBeInTheDocument();
  });

  it("distinguishes missing matches and retries transient detail failures", async () => {
    setDevUser();
    let attempts = 0;
    server.use(
      http.get("/api/matches/:matchId", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json(makeMatchDetail());
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("試合詳細を読み込めませんでした")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "試合詳細を再読み込み" }));

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("keeps the match visible and retries failed condition enrichment locally", async () => {
    setDevUser();
    let shouldFail = true;
    const attempts = new Map<string, number>();
    const count = (resource: string) => {
      attempts.set(resource, (attempts.get(resource) ?? 0) + 1);
    };
    server.use(
      http.get("/api/held-events", () => {
        count("held-events");
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({
              items: [
                makeHeldEventResponse({
                  heldAt: "2026-01-02T03:04:00.000Z",
                  id: "held-1",
                }),
              ],
            });
      }),
      http.get("/api/game-titles", () => {
        count("game-titles");
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({
              items: [
                {
                  createdAt: "2026-01-01T00:00:00.000Z",
                  displayOrder: 1,
                  id: "gt_momotetsu_2",
                  layoutFamily: "momotetsu_2",
                  name: "桃太郎電鉄2",
                },
              ],
            });
      }),
      http.get("/api/season-masters", () => {
        count("seasons");
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({
              items: [
                {
                  createdAt: "2026-01-01T00:00:00.000Z",
                  displayOrder: 1,
                  gameTitleId: "gt_momotetsu_2",
                  id: "season_current",
                  name: "今シーズン",
                },
              ],
            });
      }),
      http.get("/api/map-masters", () => {
        count("maps");
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({
              items: [
                {
                  createdAt: "2026-01-01T00:00:00.000Z",
                  displayOrder: 1,
                  gameTitleId: "gt_momotetsu_2",
                  id: "map_east",
                  name: "東日本編",
                },
              ],
            });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    const warning = await screen.findByText("開催条件を取得できませんでした");
    expect(warning.closest("section")).toHaveTextContent(
      "開催日・作品名・シーズン名・マップ名を取得できませんでした",
    );
    expect(screen.getByRole("list", { name: "試合の順位と成績" }).children).toHaveLength(4);
    const identity = screen.getByRole("region", { name: "第1試合の開催条件" });
    expect(within(identity).getAllByText("未取得")).toHaveLength(3);

    shouldFail = false;
    await user.click(screen.getByRole("button", { name: "開催条件を再取得" }));

    expect(await within(identity).findByText("桃太郎電鉄2")).toBeInTheDocument();
    expect(within(identity).getByText("今シーズン")).toBeInTheDocument();
    expect(within(identity).getByText("東日本編")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("開催条件を取得できませんでした")).not.toBeInTheDocument(),
    );
    expect(Object.fromEntries(attempts)).toEqual({
      "game-titles": 2,
      "held-events": 2,
      maps: 2,
      seasons: 2,
    });
  });

  it("does not offer retry for a missing match", async () => {
    setDevUser();
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/missing"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("試合が見つかりません")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "試合詳細を再読み込み" })).not.toBeInTheDocument();
  });

  it("returns to the held event after deleting a match", async () => {
    setDevUser();
    const invalidationGate = createDeferred();
    let heldEventDirectoryRequests = 0;
    server.use(
      http.get("/api/held-events", async () => {
        heldEventDirectoryRequests += 1;
        if (heldEventDirectoryRequests > 1) {
          await invalidationGate.promise;
        }
        return HttpResponse.json({
          items: [makeHeldEventResponse({ id: "held-1" })],
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <LocationProbe />
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
            <Route path="/held-events/:heldEventId" element={<p>held-event-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(heldEventDirectoryRequests).toBe(2));
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("/held-events/held-1"),
    );
    expect(screen.getByText("held-event-page")).toBeInTheDocument();
    expect(queryClient.getQueryData(matchKeys.detail("match-1"))).toBeUndefined();

    await act(async () => invalidationGate.resolve());
  });

  it("does not navigate back after leaving the detail while delete invalidation is pending", async () => {
    setDevUser();
    const invalidationGate = createDeferred();
    let heldEventDirectoryRequests = 0;
    server.use(
      http.get("/api/held-events", async () => {
        heldEventDirectoryRequests += 1;
        if (heldEventDirectoryRequests > 1) await invalidationGate.promise;
        return HttpResponse.json({
          items: [makeHeldEventResponse({ id: "held-1" })],
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <GlobalNavigationButton />
          <LocationProbe />
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
            <Route path="/held-events/:heldEventId" element={<p>held-event-page</p>} />
            <Route path="/other" element={<p>other-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(heldEventDirectoryRequests).toBe(2));
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("/held-events/held-1"),
    );
    expect(queryClient.getQueryData(matchKeys.detail("match-1"))).toBeUndefined();

    act(() => screen.getByTestId("leave-match-detail").click());
    expect(screen.getByLabelText("current location")).toHaveTextContent("/other");
    expect(screen.getByText("other-page")).toBeInTheDocument();

    await act(async () => invalidationGate.resolve());
    await waitFor(() =>
      expect(queryClient.getQueryData(matchKeys.detail("match-1"))).toBeUndefined(),
    );

    expect(screen.getByLabelText("current location")).toHaveTextContent("/other");
    expect(screen.getByText("other-page")).toBeInTheDocument();
    expect(screen.queryByText("held-event-page")).not.toBeInTheDocument();
  });

  it("does not navigate after a pending delete succeeds on a page that has unmounted", async () => {
    setDevUser();
    const deleteGate = createDeferred();
    let deleteStarted = false;
    server.use(
      http.delete("/api/matches/:matchId", async ({ params }) => {
        deleteStarted = true;
        await deleteGate.promise;
        return HttpResponse.json({ deleted: true, matchId: params["matchId"] });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <GlobalNavigationButton />
          <LocationProbe />
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
            <Route path="/held-events/:heldEventId" element={<p>held-event-page</p>} />
            <Route path="/other" element={<p>other-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(deleteStarted).toBe(true));

    act(() => screen.getByTestId("leave-match-detail").click());
    expect(screen.getByLabelText("current location")).toHaveTextContent("/other");

    await act(async () => deleteGate.resolve());
    await waitFor(() =>
      expect(queryClient.getQueryData(matchKeys.detail("match-1"))).toBeUndefined(),
    );

    expect(screen.getByLabelText("current location")).toHaveTextContent("/other");
    expect(screen.getByText("other-page")).toBeInTheDocument();
    expect(screen.queryByText("held-event-page")).not.toBeInTheDocument();
  });

  it("does not surface a pending delete failure on a different match detail", async () => {
    setDevUser();
    const deleteGate = createDeferred();
    let deleteStarted = false;
    server.use(
      http.delete("/api/matches/:matchId", async () => {
        deleteStarted = true;
        await deleteGate.promise;
        return HttpResponse.json({ detail: "delete failed" }, { status: 500 });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <GlobalNavigationButton destination="/matches/match-2" />
          <LocationProbe />
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(deleteStarted).toBe(true));

    act(() => screen.getByTestId("leave-match-detail").click());
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("/matches/match-2"),
    );
    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "試合を削除しますか？" })).not.toBeInTheDocument();

    await act(async () => deleteGate.resolve());
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(screen.getByLabelText("current location")).toHaveTextContent("/matches/match-2");
    expect(screen.queryByText("削除に失敗しました")).not.toBeInTheDocument();
    expect(screen.queryByText("delete failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "試合を削除しますか？" })).not.toBeInTheDocument();
  });

  it("returns to the originating filtered list after deleting a match", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            "/matches/match-1?returnTo=%2Fmatches%3Fstatus%3Dconfirmed%26cursor%3Dcursor-2",
          ]}
        >
          <LocationProbe />
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
            <Route path="/matches" element={<p>filtered-list</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("link", { name: "試合一覧へ戻る" })).toHaveAttribute(
      "href",
      "/matches?status=confirmed&cursor=cursor-2",
    );
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "/matches?status=confirmed&cursor=cursor-2",
      ),
    );
  });

  it("ignores a return destination that points back to the deleted match detail", async () => {
    setDevUser();
    const removeQueries = vi.spyOn(queryClient, "removeQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/matches/match-1?returnTo=%2Fmatches%2Fmatch-1%2F%3Fsource%3Dcrafted"]}
          useTransitions={false}
        >
          <LocationProbe />
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
            <Route path="/held-events/:heldEventId" element={<p>held-event-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("/held-events/held-1"),
    );
    expect(screen.getByText("held-event-page")).toBeInTheDocument();
    expect(screen.queryByLabelText("試合詳細を読み込み中")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(removeQueries).toHaveBeenCalledWith({
        exact: true,
        queryKey: matchKeys.detail("match-1"),
      }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(matchKeys.detail("match-1"))).toBeUndefined(),
    );
  });

  it("shows match feature badges supplied by the pinned analysis artifact", async () => {
    setDevUser();
    const contextSearches: string[] = [];
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json(
          makeMatchDetail({
            players: makeFourPlayerResults([
              {
                incidents: makeIncidents({ suriNoGinji: 1 }),
                rank: 2,
                revenueManYen: 900,
                totalAssetsManYen: -100,
              },
              {
                incidents: makeIncidents({ suriNoGinji: 1 }),
                rank: 1,
                revenueManYen: 300,
                totalAssetsManYen: 1000,
              },
              { rank: 3, revenueManYen: 700, totalAssetsManYen: 500 },
              { rank: 4, revenueManYen: 600, totalAssetsManYen: 400 },
            ]),
          }),
        ),
      ),
      http.get("/api/analytics/series-comparison/v2/match-context", ({ request }) => {
        contextSearches.push(new URL(request.url).search);
        const context = makeSeriesAnalysisMatchContext();
        if (!context.match) throw new Error("fixture must include a match");
        return HttpResponse.json({
          ...context,
          matchId: "match-1",
          match: {
            ...context.match,
            features: [
              {
                evidence: [],
                featureCode: "close_finish",
                memberIds: [],
                priority: 1,
                source: "series",
                tone: "neutral",
              },
              {
                evidence: [],
                featureCode: "revenue_top_no_win",
                memberIds: [],
                priority: 2,
                source: "match",
                tone: "notice",
              },
              {
                evidence: [],
                featureCode: "ginji_storm",
                memberIds: [],
                priority: 3,
                source: "match",
                tone: "notice",
              },
              {
                evidence: [],
                featureCode: "negative_assets",
                memberIds: [],
                priority: 4,
                source: "match",
                tone: "notice",
              },
              {
                evidence: [],
                featureCode: "no_destination",
                memberIds: [],
                priority: 5,
                source: "match",
                tone: "neutral",
              },
              {
                evidence: [],
                featureCode: "low_revenue_win",
                memberIds: [],
                priority: 6,
                source: "match",
                tone: "neutral",
              },
            ],
            matchIndex: 1,
          },
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合の特徴" })).toBeInTheDocument();
    expect(await screen.findByText("接戦")).toBeInTheDocument();
    expect(screen.getByText("物件収益ねじれ")).toBeInTheDocument();
    expect(screen.getByText("スリの銀次多発")).toBeInTheDocument();
    expect(screen.getByText("借金あり")).toBeInTheDocument();
    expect(screen.getByText("目的地なし決着")).toBeInTheDocument();
    expect(screen.getByText("低収益勝ち")).toBeInTheDocument();
    expect(screen.getByText("同条件内")).toBeInTheDocument();
    const contextParams = new URLSearchParams(contextSearches.at(-1));
    expect(contextParams.get("artifactId")).toBe("artifact-current");
    expect(contextParams.get("gameTitleId")).toBe("gt_momotetsu_2");
    expect(contextParams.get("seasonMasterId")).toBe("season_current");
    expect(contextParams.get("mapMasterId")).toBe("map_east");
    expect(contextParams.get("matchId")).toBe("match-1");
  });

  it.each([
    {
      name: "refetches the same context when status still points to the expired artifact",
      replace: false,
    },
    {
      name: "moves to the replacement context when status points to a new artifact",
      replace: true,
    },
  ])("$name", async ({ replace }) => {
    setDevUser();
    const replacementArtifact = {
      ...analysisArtifact,
      artifactId: "artifact-replacement",
      inputRevision: "13",
      publishedAt: "2026-08-09T03:00:00.000Z",
    };
    const recoveredArtifact = replace ? replacementArtifact : analysisArtifact;
    let statusAttempts = 0;
    const contextArtifactIds: string[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () => {
        statusAttempts += 1;
        return HttpResponse.json(
          makeSeriesAnalysisStatus({
            currentArtifact: statusAttempts === 1 ? analysisArtifact : recoveredArtifact,
            desired: {
              algorithmVersion: recoveredArtifact.algorithmVersion,
              artifactSchemaVersion: recoveredArtifact.artifactSchemaVersion,
              inputRevision: recoveredArtifact.inputRevision,
            },
          }),
        );
      }),
      http.get("/api/analytics/series-comparison/v2/match-context", ({ request }) => {
        const artifactId = new URL(request.url).searchParams.get("artifactId") ?? "";
        contextArtifactIds.push(artifactId);
        if (contextArtifactIds.length === 1) {
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
        return HttpResponse.json({
          ...makeSeriesAnalysisMatchContext(),
          artifact: recoveredArtifact,
          matchId: "match-1",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("接戦")).toBeInTheDocument();
    expect(statusAttempts).toBe(2);
    expect(contextArtifactIds).toEqual([analysisArtifact.artifactId, recoveredArtifact.artifactId]);
  });

  it("checks analysis status only after manual update from a ready feature view", async () => {
    setDevUser();
    let statusAttempts = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () => {
        statusAttempts += 1;
        return HttpResponse.json(makeSeriesAnalysisStatus());
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("接戦")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "特徴を更新" })).toBeInTheDocument();
    expect(statusAttempts).toBe(1);

    await dispatchPassiveRefreshSignals();
    expect(statusAttempts).toBe(1);

    await user.click(screen.getByRole("button", { name: "特徴を更新" }));

    await waitFor(() => expect(statusAttempts).toBe(2));
    expect(screen.getByText("接戦")).toBeInTheDocument();
  });

  it("refreshes queued match features only after the explicit update action", async () => {
    setDevUser();
    let statusAttempts = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () => {
        statusAttempts += 1;
        return HttpResponse.json(
          statusAttempts === 1
            ? makeSeriesAnalysisStatus({
                artifactFreshness: "unavailable",
                calculation: {
                  finishedAt: null,
                  requestedAt: "2026-08-09T01:00:00.000Z",
                  startedAt: null,
                  status: "queued",
                  trigger: "match_mutation",
                },
                currentArtifact: null,
              })
            : makeSeriesAnalysisStatus(),
        );
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "特徴を更新" })).toBeInTheDocument();
    expect(statusAttempts).toBe(1);

    await dispatchPassiveRefreshSignals();
    expect(statusAttempts).toBe(1);

    await user.click(screen.getByRole("button", { name: "特徴を更新" }));

    expect(await screen.findByText("接戦")).toBeInTheDocument();
    expect(statusAttempts).toBe(2);
  });

  it("keeps a failed queued-status refresh recoverable instead of leaving retry pending", async () => {
    setDevUser();
    let statusAttempts = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () => {
        statusAttempts += 1;
        if (statusAttempts === 2) {
          return HttpResponse.json({ title: "status unavailable" }, { status: 500 });
        }
        return HttpResponse.json(
          statusAttempts === 1
            ? makeSeriesAnalysisStatus({
                artifactFreshness: "unavailable",
                calculation: {
                  finishedAt: null,
                  requestedAt: "2026-08-09T01:00:00.000Z",
                  startedAt: null,
                  status: "queued",
                  trigger: "match_mutation",
                },
                currentArtifact: null,
              })
            : makeSeriesAnalysisStatus(),
        );
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "特徴を更新" }));

    expect(await screen.findByText("試合の特徴を読み込めません")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "特徴を再読み込み" });
    expect(retry).toBeEnabled();
    expect(statusAttempts).toBe(2);

    await user.click(retry);

    expect(await screen.findByText("接戦")).toBeInTheDocument();
    expect(statusAttempts).toBe(3);
  });

  it("does not refetch immutable context when manual status refresh keeps the same artifact", async () => {
    setDevUser();
    const refreshGate = createDeferred();
    let statusAttempts = 0;
    let contextAttempts = 0;
    const queuedStatus = makeSeriesAnalysisStatus({
      artifactFreshness: "stale",
      calculation: {
        finishedAt: null,
        requestedAt: "2026-08-09T01:30:00.000Z",
        startedAt: null,
        status: "queued",
        trigger: "match_mutation",
      },
      currentArtifact: analysisArtifact,
    });
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", async () => {
        statusAttempts += 1;
        if (statusAttempts === 2) await refreshGate.promise;
        return HttpResponse.json(queuedStatus);
      }),
      http.get("/api/analytics/series-comparison/v2/match-context", () => {
        contextAttempts += 1;
        return HttpResponse.json({
          ...makeSeriesAnalysisMatchContext(),
          matchId: "match-1",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("接戦")).toBeInTheDocument();
    expect(contextAttempts).toBe(1);

    await user.click(screen.getByRole("button", { name: "特徴を更新" }));

    await waitFor(() => expect(statusAttempts).toBe(2));
    expect(screen.getByRole("button", { name: "特徴を更新中" })).toBeDisabled();
    expect(contextAttempts).toBe(1);

    await act(async () => refreshGate.resolve());

    await waitFor(() => expect(screen.getByRole("button", { name: "特徴を更新" })).toBeEnabled());
    expect(screen.getByText("接戦")).toBeInTheDocument();
    expect(contextAttempts).toBe(1);
  });

  it("keeps the published features visible while a queued analysis waits for manual refresh", async () => {
    setDevUser();
    const nextArtifact = {
      ...analysisArtifact,
      artifactId: "artifact-next",
      inputRevision: "13",
      publishedAt: "2026-08-09T02:00:00.000Z",
    };
    let statusAttempts = 0;
    const requestedContextArtifacts: string[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () => {
        statusAttempts += 1;
        return HttpResponse.json(
          statusAttempts === 1
            ? makeSeriesAnalysisStatus({
                artifactFreshness: "stale",
                calculation: {
                  finishedAt: null,
                  requestedAt: "2026-08-09T01:30:00.000Z",
                  startedAt: null,
                  status: "queued",
                  trigger: "match_mutation",
                },
                currentArtifact: analysisArtifact,
                desired: {
                  algorithmVersion: analysisArtifact.algorithmVersion,
                  artifactSchemaVersion: analysisArtifact.artifactSchemaVersion,
                  inputRevision: nextArtifact.inputRevision,
                },
              })
            : makeSeriesAnalysisStatus({
                calculation: {
                  finishedAt: nextArtifact.publishedAt,
                  requestedAt: "2026-08-09T01:30:00.000Z",
                  startedAt: "2026-08-09T01:31:00.000Z",
                  status: "succeeded",
                  trigger: "match_mutation",
                },
                currentArtifact: nextArtifact,
                desired: {
                  algorithmVersion: nextArtifact.algorithmVersion,
                  artifactSchemaVersion: nextArtifact.artifactSchemaVersion,
                  inputRevision: nextArtifact.inputRevision,
                },
              }),
        );
      }),
      http.get("/api/analytics/series-comparison/v2/match-context", ({ request }) => {
        const artifactId = new URL(request.url).searchParams.get("artifactId") ?? "";
        requestedContextArtifacts.push(artifactId);
        const context = makeSeriesAnalysisMatchContext();
        if (!context.match) throw new Error("fixture must include a match");
        return HttpResponse.json({
          ...context,
          artifact: artifactId === nextArtifact.artifactId ? nextArtifact : analysisArtifact,
          matchId: "match-1",
          match:
            artifactId === nextArtifact.artifactId
              ? {
                  ...context.match,
                  features: [
                    {
                      evidence: [],
                      featureCode: "negative_assets",
                      memberIds: [],
                      priority: 1,
                      source: "match",
                      tone: "notice",
                    },
                  ],
                }
              : context.match,
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("接戦")).toBeInTheDocument();
    expect(
      screen.getByText("新しい分析を計算しています。完了状況は更新して確認できます。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "特徴を更新" })).toBeInTheDocument();
    expect(statusAttempts).toBe(1);
    expect(requestedContextArtifacts).toEqual([analysisArtifact.artifactId]);

    await dispatchPassiveRefreshSignals();
    expect(statusAttempts).toBe(1);
    expect(requestedContextArtifacts).toEqual([analysisArtifact.artifactId]);

    await user.click(screen.getByRole("button", { name: "特徴を更新" }));

    expect(await screen.findByText("借金あり")).toBeInTheDocument();
    expect(screen.queryByText("接戦")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "特徴を更新" })).toBeInTheDocument();
    expect(statusAttempts).toBe(2);
    expect(requestedContextArtifacts).toEqual([
      analysisArtifact.artifactId,
      nextArtifact.artifactId,
    ]);
  });

  it("keeps the match result and retries a failed feature-context request locally", async () => {
    setDevUser();
    let contextAttempts = 0;
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json(
          makeMatchDetail({
            players: makeFourPlayerResults([
              { rank: 1, revenueManYen: 300 },
              { rank: 2, revenueManYen: 400 },
              { rank: 3, revenueManYen: 200 },
              { rank: 4, revenueManYen: 100 },
            ]),
          }),
        ),
      ),
      http.get("/api/analytics/series-comparison/v2/match-context", () => {
        contextAttempts += 1;
        return contextAttempts === 1
          ? HttpResponse.json({ title: "series unavailable" }, { status: 500 })
          : HttpResponse.json({
              ...makeSeriesAnalysisMatchContext(),
              matchId: "match-1",
            });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    expect(await screen.findByText("試合の特徴を読み込めません")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "試合の順位と成績" }).children).toHaveLength(4);
    expect(
      screen.queryByText("同じ条件の試合と比べて、表示対象の特徴はありません。"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("接戦")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "特徴を再読み込み" }));

    expect(await screen.findByText("接戦")).toBeInTheDocument();
    expect(contextAttempts).toBe(2);
  });

  it("keeps primary match rows but hides stale analysis after a match revision mismatch", async () => {
    setDevUser();
    server.use(
      http.get("/api/analytics/series-comparison/v2/match-context", () => {
        const context = makeSeriesAnalysisMatchContext();
        return HttpResponse.json({
          ...context,
          inclusion: { status: "match_changed_since_artifact" },
          match: null,
          matchId: "match-1",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(
        "この試合の更新後は、同じ条件の試合と比べた特徴を次の分析完了後に表示します。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "特徴を更新" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "試合の順位と成績" }).children).toHaveLength(4);
    expect(screen.getAllByText("比較データなし")).toHaveLength(4);
    expect(screen.queryByText("1.82 → 1.75")).not.toBeInTheDocument();
  });
});
