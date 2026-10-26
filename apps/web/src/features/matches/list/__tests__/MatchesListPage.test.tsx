import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MatchDetailPage } from "@/features/matches/detail/MatchDetailPage";
import { MatchesListPage } from "@/features/matches/list/MatchesListPage";
import type { MatchSummaryResponse } from "@/shared/api/matches";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";
import { makeFourPlayerResults, makeHeldEventResponse, makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();

let user: ReturnType<typeof userEvent.setup>;

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

function GlobalNavigationButton({ destination = "/other" }: { destination?: string }) {
  const navigate = useNavigate();
  return (
    <button data-testid="leave-list" type="button" onClick={() => navigate(destination)}>
      leave list
    </button>
  );
}

function confirmedMatch(
  number: number,
  overrides: Partial<MatchSummaryResponse> = {},
): MatchSummaryResponse {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    gameTitleId: "gt_momotetsu_2",
    hasNote: false,
    heldEventId: "held-1",
    id: `match-${number}`,
    kind: "match",
    mapMasterId: "map_east",
    mapName: "東日本編",
    matchId: `match-${number}`,
    matchNoInEvent: number,
    ownerMemberId: "member_ponta",
    playedAt: "2026-01-01T00:00:00.000Z",
    ranks: [
      { memberId: "member_ponta", playOrder: 1, rank: 1 },
      { memberId: "member_akane_mami", playOrder: 2, rank: 2 },
      { memberId: "member_otaka", playOrder: 3, rank: 3 },
      { memberId: "member_eu", playOrder: 4, rank: 4 },
    ],
    seasonMasterId: "season_current",
    status: "confirmed",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function listResponse(
  items: MatchSummaryResponse[],
  pagination: Partial<{
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    lastCursor: string | null;
    nextCursor: string | null;
    page: number;
    pageSize: number;
    previousCursor: string | null;
    totalItems: number;
    totalPages: number;
  }> = {},
) {
  return {
    items,
    pagination: {
      hasNextPage: false,
      hasPreviousPage: false,
      page: 1,
      pageSize: 25,
      totalItems: items.length,
      totalPages: items.length === 0 ? 0 : 1,
      ...pagination,
    },
  };
}

function renderList(initialEntry = "/matches", extra: React.ReactNode = null) {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        {extra}
        <Routes>
          <Route path="/matches" element={<MatchesListPage />} />
          <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          <Route path="/other" element={<p>other-page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const location = () => screen.getByLabelText("current location");
const listRegion = () => screen.getByRole("region", { name: "確定済みの試合" });

let queryClient: QueryClient;

describe("MatchesListPage", () => {
  let matchMedia: MatchMediaController;
  beforeEach(() => {
    queryClient = createTestQueryClient();
    matchMedia = installMatchMediaController(true);
    user = userEvent.setup();
    setDevUser();
  });

  afterEach(() => {
    matchMedia.restore();
  });

  it("exposes the initial list loading state until the first result arrives", async () => {
    const gate = createDeferred();
    server.use(
      http.get("/api/matches", async () => {
        await gate.promise;
        return HttpResponse.json(listResponse([]));
      }),
    );
    renderList();

    expect(screen.getByRole("status", { name: "試合一覧を読み込み中" })).toBeInTheDocument();
    expect(screen.queryByText("試合はまだありません")).not.toBeInTheDocument();
    await act(async () => gate.resolve());
    expect(await screen.findByText("試合はまだありません")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "試合一覧を読み込み中" })).not.toBeInTheDocument();
  });

  it.each([true, false])(
    "searches confirmed matches and exposes memo and export (desktop=%s)",
    async (desktop) => {
      matchMedia.setMatches(desktop);
      const requests: URLSearchParams[] = [];
      server.use(
        http.get("/api/matches", ({ request }) => {
          requests.push(new URL(request.url).searchParams);
          return HttpResponse.json(
            listResponse([
              confirmedMatch(1, { hasNote: true, noteBody: "İ: 終盤のキングボンビーで逆転された" }),
            ]),
          );
        }),
      );
      renderList(
        "/matches?q=%E3%83%9C%E3%83%B3%E3%83%93%E3%83%BC&memberId=member_ponta&record=suri_no_ginji&recordValue=1",
      );

      const title = await within(
        await screen.findByRole("region", { name: "確定済みの試合" }),
      ).findByRole("link", { name: "第1試合 · 東日本編" });
      expect(title).toHaveAttribute("href", "/matches/match-1");
      expect(Object.fromEntries(requests.at(-1)!)).toMatchObject({
        kind: "match",
        memberId: "member_ponta",
        q: "ボンビー",
        record: "suri_no_ginji",
        recordRange: "gte",
        recordValue: "1",
        sort: "held_desc",
        status: "confirmed",
      });
      const mark = listRegion().querySelector("mark");
      expect(mark).toHaveTextContent("ボンビー");
      expect(within(listRegion()).getByText(/終盤のキング/u)).toBeInTheDocument();
      expect(
        within(listRegion()).getByRole("link", { name: "第1試合をCSV/TSV出力" }),
      ).toHaveAttribute("href", "/exports?matchId=match-1");
      // The total fits on one page, so the toolbar owns the count instead of pagination.
      expect(within(listRegion()).getByText("1試合")).toBeInTheDocument();
      expect(
        screen.queryByRole("navigation", { name: "ページネーション" }),
      ).not.toBeInTheDocument();
      // Conditions that cannot be expressed as an export scope fall back to the full export.
      const toolbar = within(listRegion()).getByRole("group", { name: "試合一覧の操作" });
      expect(within(toolbar).getByRole("link", { name: "まとめて出力" })).toHaveAttribute(
        "href",
        "/exports",
      );
    },
  );

  it("carries an export-compatible held-event scope and moves the count into pagination", async () => {
    server.use(
      http.get("/api/matches", () =>
        HttpResponse.json(
          listResponse([confirmedMatch(1)], { totalItems: 40, totalPages: 2, hasNextPage: true }),
        ),
      ),
    );
    renderList("/matches?heldEventId=held-1");

    const region = await screen.findByRole("region", { name: "確定済みの試合" });
    const toolbar = await within(region).findByRole("group", { name: "試合一覧の操作" });
    expect(within(toolbar).getByRole("link", { name: "この条件で出力" })).toHaveAttribute(
      "href",
      "/exports?heldEventId=held-1",
    );
    expect(await within(region).findByText("1〜25件／全40件")).toBeInTheDocument();
    expect(within(region).queryByText("40試合")).not.toBeInTheDocument();
  });

  it("removes one applied condition from the URL with its chip", async () => {
    renderList(
      "/matches?gameTitleId=gt_momotetsu_2&q=bonby&memberId=member_ponta&record=destination&recordValue=2&sort=held_asc",
    );

    const chips = await screen.findByRole("list", { name: "適用中の条件" });
    // Title is a visible control on PC, so only hidden detail conditions become chips.
    expect(within(chips).queryByRole("button", { name: /作品/u })).not.toBeInTheDocument();
    await user.click(within(chips).getByRole("button", { name: "メモ「bonby」 を解除" }));

    await waitFor(() =>
      expect(location()).toHaveTextContent(
        "/matches?gameTitleId=gt_momotetsu_2&memberId=member_ponta&record=destination&recordValue=2&sort=held_asc",
      ),
    );
    expect(
      within(screen.getByRole("list", { name: "適用中の条件" })).getByRole("button", {
        name: "ぽんた の 目的地 2回以上 を解除",
      }),
    ).toBeInTheDocument();
  });

  it.each([
    { count: 3, visible: true },
    { count: 0, visible: false },
  ])("shows the draft notice only when drafts remain ($count)", async ({ count, visible }) => {
    server.use(
      http.get("/api/matches/summary", () =>
        HttpResponse.json({
          incompleteCount: count,
          needsReviewCount: 0,
          ocrRunningCount: 0,
          preConfirmCount: count,
        }),
      ),
    );
    renderList();

    await screen.findByRole("link", { name: "第1試合 · 東日本編" });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    if (visible) {
      expect(screen.getByText("確定前の下書き 3件")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "下書きを確認" })).toHaveAttribute("href", "/drafts");
    } else {
      expect(screen.queryByText(/確定前の下書き/u)).not.toBeInTheDocument();
    }
  });

  it("offers registration when there are no matches yet", async () => {
    server.use(http.get("/api/matches", () => HttpResponse.json(listResponse([]))));
    renderList();

    expect(await screen.findByText("試合はまだありません")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "OCR取り込み" }).at(-1)).toHaveAttribute(
      "href",
      "/ocr/new",
    );
    expect(screen.getAllByRole("link", { name: "手入力で作成" }).at(-1)).toHaveAttribute(
      "href",
      "/matches/new",
    );
  });

  it("clears conditions and paging from an empty search while keeping the sort", async () => {
    server.use(http.get("/api/matches", () => HttpResponse.json(listResponse([]))));
    renderList("/matches?q=nothing&sort=held_asc&cursor=opaque-cursor");

    expect(await screen.findByText("条件に合う試合はありません")).toBeInTheDocument();
    const empty = screen.getByText("条件に合う試合はありません").closest("div")!.parentElement!;
    await user.click(within(empty).getByRole("button", { name: "条件をすべて解除" }));

    await waitFor(() => expect(location()).toHaveTextContent(/^\/matches\?sort=held_asc$/u));
  });

  it("commits detail navigation immediately while the detail payload is loading", async () => {
    const detailGate = createDeferred();
    let detailRequested = false;
    server.use(
      http.get("/api/matches/:matchId", async ({ params }) => {
        detailRequested = true;
        await detailGate.promise;
        return HttpResponse.json(
          makeMatchDetail({ matchId: String(params["matchId"]), players: makeFourPlayerResults() }),
        );
      }),
    );
    renderList();

    await user.click(await screen.findByRole("link", { name: "第1試合 · 東日本編" }));

    await waitFor(() => expect(location()).toHaveTextContent("/matches/match-1"));
    expect(await screen.findByLabelText("試合詳細を読み込み中")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await waitFor(() => expect(detailRequested).toBe(true));
    detailGate.resolve();
    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
  });

  it("retries a failed match list without presenting it as empty", async () => {
    let attempts = 0;
    const cursors: Array<string | null> = [];
    server.use(
      http.get("/api/matches", ({ request }) => {
        attempts += 1;
        cursors.push(new URL(request.url).searchParams.get("cursor"));
        return attempts === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json(listResponse([]));
      }),
    );
    renderList("/matches?cursor=stale-cursor");

    expect(await screen.findByText("試合一覧を読み込めません")).toBeInTheDocument();
    expect(screen.queryByText("試合はまだありません")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "一覧を再読み込み" }));

    expect(await screen.findByText("試合はまだありません")).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(cursors).toEqual(["stale-cursor", null]);
    expect(location()).not.toHaveTextContent("cursor=");
  });

  it("puts a held event chosen in the detail conditions into the URL", async () => {
    renderList();

    await screen.findByRole("link", { name: "第1試合 · 東日本編" });
    await user.click(screen.getByRole("button", { name: "詳細条件" }));
    await user.click(await screen.findByRole("button", { name: "開催を変更" }));
    await user.click(await screen.findByRole("radio", { name: /2026\/01\/01/u }));

    await waitFor(() => expect(location()).toHaveTextContent("heldEventId=held-1"));
  });

  it("uses opaque cursor navigation and reuses the fresh first-page cache", async () => {
    const requestedCursors: Array<string | null> = [];
    const items = [1, 2, 3].map((number) => confirmedMatch(number));
    server.use(
      http.get("/api/matches", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        requestedCursors.push(cursor);
        const page =
          cursor === "last-token" ? 3 : cursor === "next-token" || cursor === "prev-token" ? 2 : 1;
        return HttpResponse.json(
          listResponse([items[page - 1]!], {
            hasNextPage: page < 3,
            hasPreviousPage: page > 1,
            lastCursor: "last-token",
            nextCursor: page === 1 ? "next-token" : page === 2 ? "last-token" : null,
            page,
            pageSize: 25,
            previousCursor: page === 3 ? "prev-token" : page === 2 ? "first-token" : null,
            totalItems: 75,
            totalPages: 3,
          }),
        );
      }),
    );
    renderList();

    const expectPage = async (page: number) => {
      expect(
        await within(listRegion()).findByRole("link", { name: `第${page}試合 · 東日本編` }),
      ).toHaveAttribute("href", `/matches/match-${page}`);
      expect(within(listRegion()).getAllByRole("rowheader")).toHaveLength(1);
    };
    await expectPage(1);
    expect(requestedCursors).toEqual([null]);

    await user.click(await screen.findByRole("button", { name: "次のページへ" }));
    await waitFor(() => expect(location()).toHaveTextContent("cursor=next-token"));
    await expectPage(2);

    await user.click(screen.getByRole("button", { name: "最後のページへ" }));
    await waitFor(() => expect(location()).toHaveTextContent("cursor=last-token"));
    await expectPage(3);

    await user.click(screen.getByRole("button", { name: "前のページへ" }));
    await waitFor(() => expect(location()).toHaveTextContent("cursor=prev-token"));
    await expectPage(2);

    const requestsBeforeFirstPage = requestedCursors.length;
    await user.click(screen.getByRole("button", { name: "先頭ページへ" }));
    await waitFor(() => expect(location()).not.toHaveTextContent("cursor="));
    expect(requestedCursors).toHaveLength(requestsBeforeFirstPage);
    await expectPage(1);
  });

  it("keeps condition focus and applies the latest condition when responses finish out of order", async () => {
    const mapGate = createDeferred();
    const latestGate = createDeferred();
    let mapRequested = false;
    let latestRequested = false;
    server.use(
      http.get("/api/matches", async ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get("mapMasterId") && params.get("sort") === "held_asc") {
          latestRequested = true;
          await latestGate.promise;
          return HttpResponse.json(listResponse([confirmedMatch(3)]));
        }
        if (params.get("mapMasterId")) {
          mapRequested = true;
          await mapGate.promise;
          return HttpResponse.json(listResponse([confirmedMatch(2)]));
        }
        return HttpResponse.json(listResponse([confirmedMatch(1)]));
      }),
    );
    renderList();

    const firstRow = await screen.findByRole("link", { name: "第1試合 · 東日本編" });
    expect(firstRow).toBeInTheDocument();
    const mapFilter = screen.getByLabelText("マップ");
    await selectOption(user, mapFilter, "map_east");
    expect(mapFilter).toHaveFocus();
    expect(listRegion().querySelector("[inert]")).not.toBeNull();
    await waitFor(() => expect(mapRequested).toBe(true));

    await user.tab();
    const sortFilter = screen.getByLabelText("並び順");
    expect(sortFilter).toHaveFocus();
    await selectOption(user, sortFilter, "held_asc");
    await waitFor(() => expect(latestRequested).toBe(true));

    latestGate.resolve();
    await waitFor(() => expect(listRegion().querySelector("[inert]")).toBeNull());
    expect(sortFilter).toHaveFocus();
    expect(
      within(listRegion()).getByRole("link", { name: "第3試合 · 東日本編" }),
    ).toBeInTheDocument();

    await act(async () => mapGate.resolve());
    expect(
      within(listRegion()).getByRole("link", { name: "第3試合 · 東日本編" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "第2試合 · 東日本編" })).not.toBeInTheDocument();
  });

  it("keeps same-scope list operations available and reports a cached refresh failure locally", async () => {
    const refreshGate = createDeferred();
    let attempts = 0;
    server.use(
      http.get("/api/matches", async () => {
        attempts += 1;
        if (attempts === 2) await refreshGate.promise;
        if (attempts === 3) {
          return HttpResponse.json({ detail: "refresh failed" }, { status: 500 });
        }
        return HttpResponse.json(listResponse([confirmedMatch(1)]));
      }),
    );
    renderList();

    await screen.findByRole("link", { name: "第1試合 · 東日本編" });
    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(attempts).toBe(2));

    expect(screen.getByRole("button", { name: "一覧を更新中" })).toBeDisabled();
    expect(listRegion().querySelector("[aria-busy=true]")).not.toBeNull();
    expect(listRegion().querySelector("[inert]")).toBeNull();
    expect(screen.getByLabelText("並び順")).toBeEnabled();

    await act(async () => refreshGate.resolve());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "最新情報に更新" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));

    expect(await screen.findByText("一覧を更新できませんでした")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第1試合 · 東日本編" })).toBeInTheDocument();
    expect(screen.getByLabelText("並び順")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "一覧を再読み込み" }));
    await waitFor(() =>
      expect(screen.queryByText("一覧を更新できませんでした")).not.toBeInTheDocument(),
    );
    expect(attempts).toBe(4);
  });

  it("keeps an opaque cursor after refresh failure and clears it only after success", async () => {
    const failedRefreshGate = createDeferred();
    const successfulRefreshGate = createDeferred();
    const requestedCursors: Array<string | null> = [];
    let cursorlessAttempts = 0;
    server.use(
      http.get("/api/matches", async ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        requestedCursors.push(cursor);
        if (!cursor) {
          cursorlessAttempts += 1;
          if (cursorlessAttempts === 1) {
            await failedRefreshGate.promise;
            return HttpResponse.json({ detail: "refresh failed" }, { status: 500 });
          }
          await successfulRefreshGate.promise;
          return HttpResponse.json(listResponse([confirmedMatch(2)]));
        }
        return HttpResponse.json(
          listResponse([confirmedMatch(1)], {
            hasPreviousPage: true,
            page: 2,
            previousCursor: "previous-token",
            totalItems: 26,
            totalPages: 2,
          }),
        );
      }),
    );
    renderList("/matches?cursor=opaque-cursor");

    await screen.findByRole("link", { name: "第1試合 · 東日本編" });
    expect(requestedCursors).toEqual(["opaque-cursor"]);

    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(requestedCursors).toEqual(["opaque-cursor", null]));
    expect(location()).toHaveTextContent("/matches?cursor=opaque-cursor");

    failedRefreshGate.resolve();
    expect(await screen.findByText("一覧を更新できませんでした")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第1試合 · 東日本編" })).toBeInTheDocument();
    expect(location()).toHaveTextContent("/matches?cursor=opaque-cursor");

    await user.click(screen.getByRole("button", { name: "一覧を再読み込み" }));
    await waitFor(() => expect(requestedCursors).toEqual(["opaque-cursor", null, null]));
    expect(location()).toHaveTextContent("/matches?cursor=opaque-cursor");

    successfulRefreshGate.resolve();
    await waitFor(() => expect(location()).toHaveTextContent(/^\/matches$/u));
    expect(await screen.findByRole("link", { name: "第2試合 · 東日本編" })).toBeInTheDocument();
    expect(screen.queryByText("一覧を更新できませんでした")).not.toBeInTheDocument();
  });

  it("does not roll back a sort change made during a cursorless refresh", async () => {
    const refreshGate = createDeferred();
    let cursorlessRefreshStarted = false;
    server.use(
      http.get("/api/matches", async ({ request }) => {
        const url = new URL(request.url);
        if (!url.searchParams.get("cursor") && url.searchParams.get("sort") === "held_desc") {
          cursorlessRefreshStarted = true;
          await refreshGate.promise;
        }
        return HttpResponse.json(listResponse([confirmedMatch(1)]));
      }),
    );
    renderList("/matches?cursor=opaque-cursor");

    await screen.findByRole("link", { name: "第1試合 · 東日本編" });
    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(cursorlessRefreshStarted).toBe(true));

    await selectOption(user, screen.getByLabelText("並び順"), "held_asc");
    await waitFor(() => expect(location()).toHaveTextContent(/^\/matches\?sort=held_asc$/u));

    refreshGate.resolve();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "最新情報に更新" })).toBeEnabled(),
    );
    expect(location()).toHaveTextContent(/^\/matches\?sort=held_asc$/u);
    expect(screen.getByLabelText("並び順")).toHaveTextContent("開催が古い順");
  });

  it("does not navigate after a pending cursor refresh unmounts", async () => {
    const refreshGate = createDeferred();
    let cursorlessRefreshStarted = false;
    server.use(
      http.get("/api/matches", async ({ request }) => {
        if (!new URL(request.url).searchParams.get("cursor")) {
          cursorlessRefreshStarted = true;
          await refreshGate.promise;
        }
        return HttpResponse.json(listResponse([confirmedMatch(1)]));
      }),
    );
    renderList("/matches?cursor=opaque-cursor", <GlobalNavigationButton />);

    await screen.findByRole("link", { name: "第1試合 · 東日本編" });
    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(cursorlessRefreshStarted).toBe(true));

    act(() => screen.getByTestId("leave-list").click());
    expect(await screen.findByText("other-page")).toBeInTheDocument();

    refreshGate.resolve();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(location()).toHaveTextContent(/^\/other$/u);
  });

  it("retries failed condition directories independently from the match list", async () => {
    let mapAttempts = 0;
    let failMaps = true;
    let listRequests = 0;
    server.use(
      http.get("/api/map-masters", () => {
        mapAttempts += 1;
        if (failMaps) {
          return HttpResponse.json({ detail: "directory refresh failed" }, { status: 500 });
        }
        return HttpResponse.json({
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
      http.get("/api/matches", () => {
        listRequests += 1;
        return HttpResponse.json(listResponse([confirmedMatch(1)]));
      }),
    );
    renderList();

    expect(await screen.findByText("検索条件の候補を一部読み込めません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第1試合 · 東日本編" })).toBeInTheDocument();
    const listRequestsBeforeRetry = listRequests;

    failMaps = false;
    await user.click(screen.getByRole("button", { name: "候補を再読み込み" }));
    await waitFor(() =>
      expect(screen.queryByText("検索条件の候補を一部読み込めません")).not.toBeInTheDocument(),
    );
    expect(mapAttempts).toBe(2);
    expect(listRequests).toBe(listRequestsBeforeRetry);
  });

  it("retries the paged held-event condition directory", async () => {
    let failPicker = true;
    let pickerAttempts = 0;
    server.use(
      http.get("/api/held-events", ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get("pageSize") !== "20") return;
        pickerAttempts += 1;
        if (failPicker) {
          return HttpResponse.json({ detail: "picker unavailable" }, { status: 500 });
        }
        return HttpResponse.json({
          items: [makeHeldEventResponse()],
          pagination: {
            hasNextPage: false,
            hasPreviousPage: false,
            page: 1,
            pageSize: 20,
            totalItems: 1,
            totalPages: 1,
          },
          totalMatchCount: 1,
        });
      }),
    );
    renderList();

    expect(await screen.findByText("検索条件の候補を一部読み込めません")).toBeInTheDocument();
    expect(pickerAttempts).toBe(1);

    failPicker = false;
    await user.click(screen.getByRole("button", { name: "候補を再読み込み" }));
    await waitFor(() =>
      expect(screen.queryByText("検索条件の候補を一部読み込めません")).not.toBeInTheDocument(),
    );
    expect(pickerAttempts).toBe(2);
  });

  describe("on a narrow screen", () => {
    beforeEach(() => {
      matchMedia.restore();
      matchMedia = installMatchMediaController(false);
    });

    it("edits every condition in the sheet and searches only when applied", async () => {
      const requests: URLSearchParams[] = [];
      const appliedSearch = createDeferred();
      let requestedAppliedSearch = false;
      server.use(
        http.get("/api/matches", async ({ request }) => {
          const params = new URL(request.url).searchParams;
          requests.push(params);
          const applied = params.get("q") === "ginji";
          if (applied) {
            requestedAppliedSearch = true;
            await appliedSearch.promise;
          }
          return HttpResponse.json(
            listResponse([
              confirmedMatch(applied ? 2 : 1, { hasNote: true, noteBody: "bonby ginji" }),
            ]),
          );
        }),
      );
      renderList("/matches?q=bonby");

      await screen.findByRole("link", { name: "第1試合 · 東日本編" });
      expect(listRegion().querySelector("mark")).toHaveTextContent("bonby");
      // Without visible controls, every applied condition is listed as a chip.
      expect(
        within(screen.getByRole("list", { name: "適用中の条件" })).getByRole("button", {
          name: "メモ「bonby」 を解除",
        }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "検索条件（1）" }));
      const dialog = await screen.findByRole("dialog", { name: "検索条件" });
      const memo = within(dialog).getByLabelText("メモに含む語句");
      expect(memo).toHaveValue("bonby");

      await user.clear(memo);
      await user.type(memo, "ginji");
      await selectOption(user, within(dialog).getByLabelText("並び順"), "held_asc");
      const requestsBeforeApply = requests.length;
      expect(location()).toHaveTextContent(/^\/matches\?q=bonby$/u);

      await user.click(within(dialog).getByRole("button", { name: "この条件で検索" }));

      await waitFor(() =>
        expect(location()).toHaveTextContent(/^\/matches\?q=ginji&sort=held_asc$/u),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "検索条件" })).not.toBeInTheDocument(),
      );
      expect(
        requests.slice(0, requestsBeforeApply).every((params) => params.get("q") === "bonby"),
      ).toBe(true);
      await waitFor(() => expect(requests.at(-1)?.get("q")).toBe("ginji"));
      await waitFor(() => expect(requestedAppliedSearch).toBe(true));
      // Retained rows must not be highlighted as if they belonged to the newly selected search.
      expect(listRegion().querySelector("mark")).toBeNull();
      appliedSearch.resolve();
      await screen.findByRole("link", { name: "第2試合 · 東日本編" });
      expect(listRegion().querySelector("mark")).toHaveTextContent("ginji");
    });
  });
});
