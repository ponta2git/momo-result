import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MatchesListPage } from "@/features/matches/list/MatchesListPage";
import { formatCompactDateTime } from "@/features/matches/list/matchListFormat";
import { MatchDetailPage } from "@/features/matches/MatchDetailPage";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";
import { makeFourPlayerResults, makeHeldEventResponse, makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
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

describe("MatchesListPage", () => {
  let queryClient: QueryClient;
  let matchMedia: MatchMediaController;
  beforeEach(() => {
    queryClient = createTestQueryClient();
    matchMedia = installMatchMediaController(true);
    user = userEvent.setup();
  });

  afterEach(() => {
    matchMedia.restore();
  });

  it("renders matches and links to detail", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
            <Route path="/matches/:matchId" element={<p>detail-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    expect(await screen.findAllByText("優勝 ぽんた")).toHaveLength(1);
    const listRegion = screen.getByRole("region", { name: "登録済みの試合" });
    expect(within(listRegion).getByText("1〜3件／全3件")).toBeInTheDocument();
    const listActions = within(listRegion).getByRole("group", { name: "試合一覧の操作" });
    const bulkExport = within(listActions).getByRole("link", { name: "CSV/TSVをまとめて出力" });
    expect(bulkExport).toHaveAttribute("href", "/exports?returnTo=%2Fmatches");
    const matchInfoCell = screen.getAllByRole("rowheader").find((cell) => {
      const text = cell.textContent ?? "";
      return [
        formatCompactDateTime("2026-01-01T00:00:00.000Z"),
        "桃太郎電鉄2",
        "今シーズン",
        "第1試合",
        "東日本編",
      ].every((part) => text.includes(part));
    });
    if (!matchInfoCell) {
      throw new Error(
        "expected the confirmed match row header to include date, title, season, match number, and map",
      );
    }
    expect(matchInfoCell).toHaveTextContent("桃太郎電鉄2");
    expect(matchInfoCell).toHaveTextContent("今シーズン");
    expect(matchInfoCell).toHaveTextContent("第1試合");
    expect(matchInfoCell).toHaveTextContent("東日本編");
    const detailLinks = await screen.findAllByRole("link", {
      name: "第1試合 東日本編の試合結果を見る",
    });
    expect(detailLinks).toHaveLength(1);
    expect(detailLinks[0]).toHaveAttribute("href", "/matches/match-1?returnTo=%2Fmatches");
    const exportLinks = await screen.findAllByRole("link", {
      name: "第1試合をCSV/TSV出力",
    });
    expect(exportLinks).toHaveLength(1);
    exportLinks.forEach((link) =>
      expect(link).toHaveAttribute("href", "/exports?matchId=match-1&returnTo=%2Fmatches"),
    );
  });

  it("mounts only the result layout for the current breakpoint and switches on resize", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("table", { name: "登録済みの試合" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "第1試合 東日本編の試合結果を見る" }).closest("article"),
    ).toBeNull();

    act(() => matchMedia.setMatches(false));

    await waitFor(() =>
      expect(screen.queryByRole("table", { name: "登録済みの試合" })).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("link", { name: "第1試合 東日本編の試合結果を見る" }).closest("article"),
    ).not.toBeNull();

    act(() => matchMedia.setMatches(true));

    expect(await screen.findByRole("table", { name: "登録済みの試合" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "第1試合 東日本編の試合結果を見る" }).closest("article"),
    ).toBeNull();
  });

  it("commits detail navigation immediately while the detail payload is loading", async () => {
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

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <LocationProbe />
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();

    const detailLinks = await screen.findAllByRole("link", {
      name: "第1試合 東日本編の試合結果を見る",
    });
    const detailLink = detailLinks[0];
    if (!detailLink) {
      throw new Error("expected a detail link");
    }
    await user.click(detailLink);

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("/matches/match-1"),
    );
    expect(await screen.findByLabelText("試合詳細を読み込み中")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("heading", { name: "試合結果を読み込み中" })).toBeInTheDocument();
    await waitFor(() => expect(detailRequested).toBe(true));

    detailGate.resolve();
    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
  });

  it("offers match creation without changing the active filters when the list is empty", async () => {
    setDevUser();
    server.use(http.get("/api/matches", () => HttpResponse.json({ items: [] })));

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    expect(await screen.findByText("試合はまだありません")).toBeInTheDocument();
    const emptyOcrAction = screen.getAllByRole("link", { name: "OCR取り込み" }).at(-1)!;
    expect(emptyOcrAction).toHaveAttribute("href", "/ocr/new?returnTo=%2Fmatches");
    const filterSection = screen.getByRole("region", { name: "試合の表示条件" });
    expect(within(filterSection).getByLabelText("確定状況")).toHaveValue("all");
  });

  it("offers one filter reset that clears status and cursor from an empty result", async () => {
    setDevUser();
    server.use(http.get("/api/matches", () => HttpResponse.json({ items: [] })));

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches?status=confirmed&cursor=opaque-cursor"]}>
          <LocationProbe />
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("該当する試合はありません")).toBeInTheDocument();
    const resetButtons = screen.getAllByRole("button", {
      name: "確定状況・並び順・詳細条件を初期状態に戻す",
    });
    expect(resetButtons).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "条件をクリア" })).not.toBeInTheDocument();

    await user.click(resetButtons[0]!);

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("/matches"),
    );
    expect(screen.getByLabelText("current location")).not.toHaveTextContent(/status=|cursor=/u);
  });

  it("retries a failed match list without presenting it as empty", async () => {
    setDevUser();
    let attempts = 0;
    const cursors: Array<string | null> = [];
    server.use(
      http.get("/api/matches", ({ request }) => {
        attempts += 1;
        cursors.push(new URL(request.url).searchParams.get("cursor"));
        return attempts === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({
              items: [],
              pagination: {
                hasNextPage: false,
                hasPreviousPage: false,
                page: 1,
                pageSize: 10,
                totalItems: 0,
                totalPages: 0,
              },
            });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches?cursor=stale-cursor"]}>
          <Routes>
            <Route
              path="/matches"
              element={
                <>
                  <LocationProbe />
                  <MatchesListPage />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("試合一覧を読み込めません")).toBeInTheDocument();
    expect(screen.queryByText("試合はまだありません")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "一覧を再読み込み" }));

    expect(await screen.findByText("試合はまだありません")).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(cursors).toEqual(["stale-cursor", null]);
    expect(screen.getByLabelText("current location")).not.toHaveTextContent("cursor=");
  });

  it("keeps status filtering usable and retries when summary counts are unavailable", async () => {
    setDevUser();
    let summaryAttempts = 0;
    server.use(
      http.get("/api/matches/summary", () => {
        summaryAttempts += 1;
        return summaryAttempts === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({
              incompleteCount: 4,
              needsReviewCount: 1,
              ocrRunningCount: 1,
              preConfirmCount: 2,
            });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const retryButton = await screen.findByRole("button", { name: "件数を再取得" });
    const statusFilter = screen.getByLabelText("確定状況");
    expect(statusFilter).toBeEnabled();
    expect(within(statusFilter).getByRole("option", { name: "未確定すべて" })).toBeInTheDocument();
    expect(within(statusFilter).queryByRole("option", { name: /0件/u })).not.toBeInTheDocument();

    await user.click(retryButton);

    expect(
      await within(statusFilter).findByRole("option", { name: "未確定すべて（4件）" }),
    ).toBeInTheDocument();
    expect(summaryAttempts).toBe(2);
  });

  it("preserves selected held-event filter in URL after submitting", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route
              path="/matches"
              element={
                <>
                  <LocationProbe />
                  <MatchesListPage />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "詳細条件" }));
    await user.click(await screen.findByRole("button", { name: "開催を変更" }));
    await user.click(await screen.findByRole("radio", { name: /2026\/01\/01/u }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("heldEventId=held-1"),
    );
  });

  it("applies sort changes to the URL search params", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route
              path="/matches"
              element={
                <>
                  <LocationProbe />
                  <MatchesListPage />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("並び順"), "updated_desc");

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("sort=updated_desc"),
    );
  });

  it("does not refetch the scope summary for list-only sorting and pagination", async () => {
    setDevUser();
    let summaryRequests = 0;
    server.use(
      http.get("/api/matches/summary", () => {
        summaryRequests += 1;
        return HttpResponse.json({
          incompleteCount: 1,
          needsReviewCount: 1,
          ocrRunningCount: 0,
          preConfirmCount: 1,
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route
              path="/matches"
              element={
                <>
                  <LocationProbe />
                  <MatchesListPage />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    const listRegion = screen.getByRole("region", { name: "登録済みの試合" });
    await waitFor(() => expect(listRegion).not.toHaveAttribute("aria-busy"));
    expect(summaryRequests).toBe(1);

    await user.selectOptions(screen.getByLabelText("並び順"), "updated_desc");
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("sort=updated_desc"),
    );
    await waitFor(() => expect(listRegion).not.toHaveAttribute("aria-busy"));

    await user.selectOptions(await screen.findByLabelText("表示件数"), "25");
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("pageSize=25"),
    );
    await waitFor(() => expect(listRegion).not.toHaveAttribute("aria-busy"));
    expect(summaryRequests).toBe(1);
  });

  it("uses opaque cursor navigation and reuses the fresh first-page cache", async () => {
    setDevUser();
    const requestedCursors: Array<string | null> = [];
    const items = [1, 2, 3].map((number) => ({
      createdAt: "2026-01-01T00:00:00.000Z",
      gameTitleId: "gt_momotetsu_2",
      heldEventId: "held-1",
      id: `match-${number}`,
      kind: "match",
      mapMasterId: "map_east",
      matchId: `match-${number}`,
      matchNoInEvent: number,
      ownerMemberId: "member_ponta",
      playedAt: "2026-01-01T00:00:00.000Z",
      ranks: [{ memberId: "member_ponta", playOrder: 1, rank: 1 }],
      seasonMasterId: "season_current",
      status: "confirmed",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    server.use(
      http.get("/api/matches", ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get("cursor");
        requestedCursors.push(cursor);
        const page =
          cursor === "last-token" ? 3 : cursor === "next-token" || cursor === "prev-token" ? 2 : 1;
        return HttpResponse.json({
          items: [items[page - 1]!],
          pagination: {
            hasNextPage: page < 3,
            hasPreviousPage: page > 1,
            lastCursor: "last-token",
            nextCursor: page === 1 ? "next-token" : page === 2 ? "last-token" : null,
            page,
            pageSize: 1,
            previousCursor: page === 3 ? "prev-token" : page === 2 ? "first-token" : null,
            totalItems: 3,
            totalPages: 3,
          },
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches?pageSize=1"]}>
          <LocationProbe />
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
            <Route path="/matches/:matchId" element={<p>detail-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    expect(requestedCursors.at(-1)).toBeNull();

    await user.click(await screen.findByRole("button", { name: "次のページへ" }));
    await waitFor(() => expect(requestedCursors.at(-1)).toBe("next-token"));
    expect(screen.getByLabelText("current location")).toHaveTextContent("cursor=next-token");

    await user.click(screen.getByRole("button", { name: "最後のページへ" }));
    await waitFor(() => expect(requestedCursors.at(-1)).toBe("last-token"));
    expect(screen.getByLabelText("current location")).toHaveTextContent("cursor=last-token");

    await user.click(screen.getByRole("button", { name: "前のページへ" }));
    await waitFor(() => expect(requestedCursors.at(-1)).toBe("prev-token"));
    expect(screen.getByLabelText("current location")).toHaveTextContent("cursor=prev-token");

    const requestsBeforeFirstPage = requestedCursors.length;
    await user.click(screen.getByRole("button", { name: "先頭ページへ" }));
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).not.toHaveTextContent("cursor="),
    );
    expect(requestedCursors).toHaveLength(requestsBeforeFirstPage);
    expect(
      await screen.findByRole("link", { name: "第1試合 東日本編の試合結果を見る" }),
    ).toBeInTheDocument();
  });

  it("shows optimistic status selection while the filtered list is refetching", async () => {
    setDevUser();
    const responseGate = createDeferred();
    let needsReviewRequested = false;
    const allItems = [
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        gameTitleId: "gt_momotetsu_2",
        heldEventId: "held-1",
        id: "draft-review-1",
        kind: "match_draft",
        mapMasterId: "map_east",
        matchDraftId: "draft-review-1",
        matchNoInEvent: 3,
        ownerMemberId: "member_ponta",
        playedAt: "2026-01-01T00:00:00.000Z",
        ranks: [],
        seasonMasterId: "season_current",
        status: "needs_review",
        updatedAt: "2026-01-02T02:00:00.000Z",
      },
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        gameTitleId: "gt_momotetsu_2",
        heldEventId: "held-1",
        id: "match-1",
        kind: "match",
        mapMasterId: "map_east",
        matchId: "match-1",
        matchNoInEvent: 1,
        ownerMemberId: "member_ponta",
        playedAt: "2026-01-01T00:00:00.000Z",
        ranks: [{ memberId: "member_ponta", playOrder: 1, rank: 1 }],
        seasonMasterId: "season_current",
        status: "confirmed",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    server.use(
      http.get("/api/matches", async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("status") === "needs_review") {
          needsReviewRequested = true;
          await responseGate.promise;
          return HttpResponse.json({
            items: allItems.filter((item) => item.status === "needs_review"),
          });
        }
        return HttpResponse.json({ items: allItems });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    const draftActionButtons = await screen.findAllByRole("button", { name: "確認事項を直す" });
    expect(draftActionButtons).not.toHaveLength(0);
    const statusFilter = screen.getByLabelText("確定状況");
    await user.selectOptions(statusFilter, "needs_review");

    expect(statusFilter).toHaveValue("needs_review");
    expect(statusFilter).toBeDisabled();
    expect(screen.getByText("一覧を更新中")).toBeInTheDocument();
    const listRegion = screen.getByRole("region", { name: "登録済みの試合" });
    expect(listRegion.querySelector("[inert]")).not.toBeNull();
    draftActionButtons.forEach((button) => expect(button).toBeDisabled());
    await waitFor(() => expect(needsReviewRequested).toBe(true));

    responseGate.resolve();
    await waitFor(() =>
      screen
        .getAllByRole("button", { name: "確認事項を直す" })
        .forEach((button) => expect(button).toBeEnabled()),
    );
    expect(statusFilter).toBeEnabled();
    expect(listRegion.querySelector("[inert]")).toBeNull();
  });

  it("keeps same-scope list operations available and reports a cached refresh failure locally", async () => {
    setDevUser();
    const refreshGate = createDeferred();
    let attempts = 0;
    const listResponse = {
      items: [
        {
          createdAt: "2026-01-01T00:00:00.000Z",
          gameTitleId: "gt_momotetsu_2",
          heldEventId: "held-1",
          id: "match-refresh-safe",
          kind: "match" as const,
          mapMasterId: "map_east",
          matchId: "match-refresh-safe",
          matchNoInEvent: 1,
          ownerMemberId: "member_ponta",
          playedAt: "2026-01-01T00:00:00.000Z",
          ranks: [{ memberId: "member_ponta", playOrder: 1, rank: 1 }],
          seasonMasterId: "season_current",
          status: "confirmed" as const,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      pagination: {
        hasNextPage: false,
        hasPreviousPage: false,
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      },
    };
    server.use(
      http.get("/api/matches", async () => {
        attempts += 1;
        if (attempts === 2) {
          await refreshGate.promise;
        }
        if (attempts === 3) {
          return HttpResponse.json({ detail: "refresh failed" }, { status: 500 });
        }
        return HttpResponse.json(listResponse);
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText("優勝 ぽんた")).not.toHaveLength(0);
    const listRegion = screen.getByRole("region", { name: "登録済みの試合" });
    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(attempts).toBe(2));

    expect(listRegion).toHaveAttribute("aria-busy", "true");
    expect(listRegion.querySelector("[inert]")).toBeNull();
    expect(screen.getByLabelText("並び順")).toBeEnabled();
    expect(screen.getByLabelText("表示件数")).toBeEnabled();
    screen
      .getAllByRole("link", { name: "第1試合 東日本編の試合結果を見る" })
      .forEach((link) => expect(link).not.toHaveAttribute("aria-disabled", "true"));

    refreshGate.resolve();
    await waitFor(() => expect(listRegion).not.toHaveAttribute("aria-busy"));
    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));

    expect(await screen.findByText("一覧を更新できませんでした")).toBeInTheDocument();
    expect(screen.getAllByText("優勝 ぽんた")).not.toHaveLength(0);
    expect(screen.getByLabelText("並び順")).toBeEnabled();
    expect(screen.getByLabelText("表示件数")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "一覧を再読み込み" }));
    await waitFor(() =>
      expect(screen.queryByText("一覧を更新できませんでした")).not.toBeInTheDocument(),
    );
    expect(attempts).toBe(4);
  });

  it("keeps an opaque cursor after refresh failure and clears it only after success", async () => {
    setDevUser();
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
          return HttpResponse.json({
            items: [
              {
                createdAt: "2026-01-02T00:00:00.000Z",
                gameTitleId: "gt_momotetsu_2",
                heldEventId: "held-1",
                id: "match-cursor-reset",
                kind: "match",
                mapMasterId: "map_east",
                matchId: "match-cursor-reset",
                matchNoInEvent: 2,
                ownerMemberId: "member_ponta",
                playedAt: "2026-01-02T00:00:00.000Z",
                ranks: [{ memberId: "member_ponta", playOrder: 1, rank: 1 }],
                seasonMasterId: "season_current",
                status: "confirmed",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ],
            pagination: {
              hasNextPage: false,
              hasPreviousPage: false,
              page: 1,
              pageSize: 10,
              totalItems: 1,
              totalPages: 1,
            },
          });
        }
        return HttpResponse.json({
          items: [
            {
              createdAt: "2026-01-01T00:00:00.000Z",
              gameTitleId: "gt_momotetsu_2",
              heldEventId: "held-1",
              id: "match-cursor-refresh",
              kind: "match",
              mapMasterId: "map_east",
              matchId: "match-cursor-refresh",
              matchNoInEvent: 1,
              ownerMemberId: "member_ponta",
              playedAt: "2026-01-01T00:00:00.000Z",
              ranks: [{ memberId: "member_ponta", playOrder: 1, rank: 1 }],
              seasonMasterId: "season_current",
              status: "confirmed",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          pagination: {
            hasNextPage: false,
            hasPreviousPage: true,
            page: 2,
            pageSize: 10,
            previousCursor: "previous-token",
            totalItems: 2,
            totalPages: 2,
          },
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches?cursor=opaque-cursor"]}>
          <LocationProbe />
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText("優勝 ぽんた")).not.toHaveLength(0);
    expect(requestedCursors).toEqual(["opaque-cursor"]);
    expect(screen.getByLabelText("current location")).toHaveTextContent(
      "/matches?cursor=opaque-cursor",
    );

    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));

    await waitFor(() => expect(requestedCursors).toEqual(["opaque-cursor", null]));
    expect(screen.getAllByText("優勝 ぽんた")).not.toHaveLength(0);
    expect(screen.getByLabelText("current location")).toHaveTextContent(
      "/matches?cursor=opaque-cursor",
    );

    failedRefreshGate.resolve();

    expect(await screen.findByText("一覧を更新できませんでした")).toBeInTheDocument();
    expect(screen.getAllByText("優勝 ぽんた")).not.toHaveLength(0);
    expect(screen.getByLabelText("current location")).toHaveTextContent(
      "/matches?cursor=opaque-cursor",
    );
    expect(screen.getByRole("button", { name: "最新情報に更新" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "一覧を再読み込み" }));

    await waitFor(() => expect(requestedCursors).toEqual(["opaque-cursor", null, null]));
    expect(screen.getByLabelText("current location")).toHaveTextContent(
      "/matches?cursor=opaque-cursor",
    );

    successfulRefreshGate.resolve();

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(/^\/matches$/u),
    );
    expect(
      await screen.findByRole("link", { name: "第2試合 東日本編の試合結果を見る" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("一覧を更新できませんでした")).not.toBeInTheDocument();
  });

  it("does not roll back a sort change made during a cursorless refresh", async () => {
    setDevUser();
    const refreshGate = createDeferred();
    let cursorlessRefreshStarted = false;
    server.use(
      http.get("/api/matches", async ({ request }) => {
        const url = new URL(request.url);
        if (!url.searchParams.get("cursor") && url.searchParams.get("sort") === "held_desc") {
          cursorlessRefreshStarted = true;
          await refreshGate.promise;
        }
        return HttpResponse.json({
          items: [
            {
              createdAt: "2026-01-01T00:00:00.000Z",
              gameTitleId: "gt_momotetsu_2",
              heldEventId: "held-1",
              id: "match-refresh-race",
              kind: "match",
              mapMasterId: "map_east",
              matchId: "match-refresh-race",
              matchNoInEvent: 1,
              ownerMemberId: "member_ponta",
              playedAt: "2026-01-01T00:00:00.000Z",
              ranks: [{ memberId: "member_ponta", playOrder: 1, rank: 1 }],
              seasonMasterId: "season_current",
              status: "confirmed",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          pagination: {
            hasNextPage: false,
            hasPreviousPage: false,
            page: 1,
            pageSize: 10,
            totalItems: 1,
            totalPages: 1,
          },
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches?cursor=opaque-cursor"]}>
          <LocationProbe />
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText("優勝 ぽんた")).not.toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(cursorlessRefreshStarted).toBe(true));

    await user.selectOptions(screen.getByLabelText("並び順"), "updated_desc");
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        /^\/matches\?sort=updated_desc$/u,
      ),
    );

    refreshGate.resolve();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "最新情報に更新" })).toBeEnabled(),
    );
    expect(screen.getByLabelText("current location")).toHaveTextContent(
      /^\/matches\?sort=updated_desc$/u,
    );
    expect(screen.getByLabelText("並び順")).toHaveValue("updated_desc");
  });

  it("does not navigate after a pending cursor refresh unmounts", async () => {
    setDevUser();
    const refreshGate = createDeferred();
    let cursorlessRefreshStarted = false;
    server.use(
      http.get("/api/matches", async ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (!cursor) {
          cursorlessRefreshStarted = true;
          await refreshGate.promise;
        }
        return HttpResponse.json({
          items: [
            {
              createdAt: "2026-01-01T00:00:00.000Z",
              gameTitleId: "gt_momotetsu_2",
              heldEventId: "held-1",
              id: "match-unmounted-refresh",
              kind: "match",
              mapMasterId: "map_east",
              matchId: "match-unmounted-refresh",
              matchNoInEvent: 1,
              ownerMemberId: "member_ponta",
              playedAt: "2026-01-01T00:00:00.000Z",
              ranks: [{ memberId: "member_ponta", playOrder: 1, rank: 1 }],
              seasonMasterId: "season_current",
              status: "confirmed",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          pagination: {
            hasNextPage: false,
            hasPreviousPage: false,
            page: 1,
            pageSize: 10,
            totalItems: 1,
            totalPages: 1,
          },
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches?cursor=opaque-cursor"]}>
          <GlobalNavigationButton />
          <LocationProbe />
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
            <Route path="/other" element={<p>other-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText("優勝 ぽんた")).not.toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(cursorlessRefreshStarted).toBe(true));

    act(() => screen.getByTestId("leave-match-detail").click());
    expect(await screen.findByText("other-page")).toBeInTheDocument();
    expect(screen.getByLabelText("current location")).toHaveTextContent(/^\/other$/u);

    refreshGate.resolve();

    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.getByLabelText("current location")).toHaveTextContent(/^\/other$/u);
  });

  it("retries failed filter directories independently from the match list", async () => {
    setDevUser();
    let gameTitleAttempts = 0;
    let failGameTitles = true;
    server.use(
      http.get("/api/game-titles", () => {
        gameTitleAttempts += 1;
        if (failGameTitles) {
          return HttpResponse.json({ detail: "directory refresh failed" }, { status: 500 });
        }
        return HttpResponse.json({
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
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("絞り込み候補を一部読み込めません")).toBeInTheDocument();
    expect(gameTitleAttempts).toBe(1);

    failGameTitles = false;
    await user.click(screen.getByRole("button", { name: "候補を再読み込み" }));

    await waitFor(() =>
      expect(screen.queryByText("絞り込み候補を一部読み込めません")).not.toBeInTheDocument(),
    );
    expect(gameTitleAttempts).toBe(2);

    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "最新情報に更新" })).toBeEnabled(),
    );
    expect(gameTitleAttempts).toBe(2);
    expect(screen.queryByText("一覧を更新できませんでした")).not.toBeInTheDocument();
  });

  it("retries the paged held-event filter directory", async () => {
    setDevUser();
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

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("絞り込み候補を一部読み込めません")).toBeInTheDocument();
    expect(pickerAttempts).toBe(1);

    failPicker = false;
    await user.click(screen.getByRole("button", { name: "候補を再読み込み" }));

    await waitFor(() =>
      expect(screen.queryByText("絞り込み候補を一部読み込めません")).not.toBeInTheDocument(),
    );
    expect(pickerAttempts).toBe(2);
  });

  it("checks a draft action before navigation and redirects to detail when already confirmed", async () => {
    setDevUser();
    let draftDetailRequested = false;
    server.use(
      http.get("/api/matches", () =>
        HttpResponse.json({
          items: [
            {
              createdAt: "2026-01-01T00:00:00.000Z",
              gameTitleId: "gt_momotetsu_2",
              heldEventId: "held-1",
              id: "draft-review-stale",
              kind: "match_draft",
              mapMasterId: "map_east",
              matchDraftId: "draft-review-stale",
              matchNoInEvent: 3,
              ownerMemberId: "member_ponta",
              playedAt: "2026-01-01T00:00:00.000Z",
              ranks: [],
              seasonMasterId: "season_current",
              status: "needs_review",
              updatedAt: "2026-01-02T02:00:00.000Z",
            },
          ],
        }),
      ),
      http.get("/api/match-drafts/:draftId", ({ params }) => {
        draftDetailRequested = true;
        const draftId = String(params["draftId"]);
        return HttpResponse.json({
          confirmedMatchId: "match-from-stale-draft",
          createdAt: "2026-01-01T00:00:00.000Z",
          matchDraftId: draftId,
          status: "confirmed",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <LocationProbe />
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
            <Route path="/matches/:matchId" element={<p>detail-page</p>} />
            <Route path="/review/:matchSessionId" element={<p>review-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    const draftActions = await screen.findAllByRole("button", { name: "確認事項を直す" });
    const draftAction = draftActions[0];
    if (!draftAction) {
      throw new Error("expected a draft action");
    }
    await user.click(draftAction);

    await waitFor(() => expect(draftDetailRequested).toBe(true));
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "/matches/match-from-stale-draft",
      ),
    );
    expect(screen.queryByText("review-page")).not.toBeInTheDocument();
  });

  it("keeps other draft actions usable while one draft status check is pending", async () => {
    setDevUser();
    const firstDraftGate = createDeferred();
    server.use(
      http.get("/api/matches", () =>
        HttpResponse.json({
          items: ["draft-pending-1", "draft-pending-2"].map((draftId, index) => ({
            createdAt: "2026-01-01T00:00:00.000Z",
            gameTitleId: "gt_momotetsu_2",
            heldEventId: "held-1",
            id: draftId,
            kind: "match_draft",
            mapMasterId: "map_east",
            matchDraftId: draftId,
            matchNoInEvent: index + 1,
            ownerMemberId: "member_ponta",
            playedAt: "2026-01-01T00:00:00.000Z",
            ranks: [],
            seasonMasterId: "season_current",
            status: "needs_review",
            updatedAt: "2026-01-02T02:00:00.000Z",
          })),
        }),
      ),
      http.get("/api/match-drafts/:draftId", async ({ params }) => {
        const draftId = String(params["draftId"]);
        if (draftId === "draft-pending-1") {
          await firstDraftGate.promise;
        }
        return HttpResponse.json({
          createdAt: "2026-01-01T00:00:00.000Z",
          matchDraftId: draftId,
          status: "needs_review",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <LocationProbe />
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
            <Route path="/review/:matchSessionId" element={<p>review-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    const draftActions = await screen.findAllByRole("button", { name: "確認事項を直す" });
    const firstDraftAction = draftActions[0];
    if (!firstDraftAction) {
      throw new Error("expected a draft action");
    }
    await user.click(firstDraftAction);

    await waitFor(() => expect(screen.getAllByRole("button", { name: "確認中…" })).toHaveLength(1));
    screen
      .getAllByRole("button", { name: "確認中…" })
      .forEach((button) => expect(button).toBeDisabled());
    screen
      .getAllByRole("button", { name: "確認事項を直す" })
      .forEach((button) => expect(button).toBeEnabled());

    firstDraftGate.resolve();
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "/review/draft-pending-1",
      ),
    );
  });
});
