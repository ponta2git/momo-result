import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { formatCompactDateTime } from "@/features/matches/list/matchListFormat";
import { MatchCreatePage } from "@/features/matches/MatchCreatePage";
import { MatchDetailPage } from "@/features/matches/MatchDetailPage";
import { MatchEditPage } from "@/features/matches/MatchEditPage";
import { MatchesListPage } from "@/features/matches/MatchesListPage";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import {
  createMatchWorkspaceMasterHandoffPayload,
  saveMasterHandoff,
} from "@/shared/workflows/matchWorkspaceMasterHandoff";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeFourPlayerResults, makeIncidents, makeMatchDetail } from "@/test/factories";
import { makeMatchWorkspaceMasterHandoffValues } from "@/test/factories/draftReview";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisMatchContext } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

let user: ReturnType<typeof userEvent.setup>;

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

describe("MatchesListPage", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
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

    const pageTitle = await screen.findByRole("heading", { name: "試合一覧" });
    expect(pageTitle).toHaveClass("text-2xl", "md:text-3xl", "text-balance");
    expect(screen.queryByLabelText("開催の振り返り")).not.toBeInTheDocument();
    expect(await screen.findAllByText("優勝 ぽんた")).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: /開催・試合/u })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "状態・次の操作" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "順位" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "結果" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "出力" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "操作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "更新" })).not.toBeInTheDocument();
    const listRegion = screen.getByRole("region", { name: "登録済みの試合" });
    expect(within(listRegion).getByText("3件")).toBeInTheDocument();
    expect(within(listRegion).getByRole("group", { name: "試合一覧の操作" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OCR取り込み" })).toHaveClass(
      "bg-[var(--color-surface)]",
    );
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
    expect(matchInfoCell).toHaveClass("align-middle");
    expect(matchInfoCell.querySelector("a")).toBeNull();
    const detailLinks = await screen.findAllByRole("link", {
      name: "第1試合 東日本編の試合結果を見る",
    });
    expect(detailLinks).toHaveLength(2);
    detailLinks.forEach((link) => {
      expect(link).toHaveAttribute("href", "/matches/match-1?returnTo=%2Fmatches");
      expect(link).toHaveClass("size-11");
    });
    const exportLinks = await screen.findAllByRole("link", {
      name: "第1試合をCSV/TSV出力",
    });
    expect(exportLinks).toHaveLength(2);
    exportLinks.forEach((link) =>
      expect(link).toHaveAttribute("href", "/exports?matchId=match-1&returnTo=%2Fmatches"),
    );
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

  it("shows empty-list state below the filter section", async () => {
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
    expect(emptyOcrAction).toHaveClass("bg-[var(--color-action)]");
    const filterSection = screen.getByRole("region", { name: "試合の表示条件" });
    expect(within(filterSection).getByLabelText("確定状況")).toHaveValue("all");
    const emptyState = screen.getByText("試合はまだありません").closest("section");
    if (!filterSection || !emptyState) {
      throw new Error("expected filter and empty-list sections to be present");
    }
    expect(filterSection.compareDocumentPosition(emptyState)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByText("未完了タスク")).not.toBeInTheDocument();
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
    expect(screen.getByText("件数を取得できません")).toBeInTheDocument();
    expect(screen.queryByText("試合はまだありません")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "一覧を再読み込み" })).toHaveClass(
      "bg-[var(--color-action)]",
    );

    await user.click(screen.getByRole("button", { name: "一覧を再読み込み" }));

    expect(await screen.findByText("試合はまだありません")).toBeInTheDocument();
    expect(screen.getByText("0件")).toBeInTheDocument();
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
    const heldEventSelect = screen.getAllByLabelText("開催")[0] as HTMLSelectElement;
    await waitFor(() =>
      expect([...heldEventSelect.options].map((option) => option.value)).toEqual(["", "held-1"]),
    );

    await user.selectOptions(heldEventSelect, "held-1");

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

  it("uses opaque cursor requests for next, last, previous, and first navigation", async () => {
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

    await user.click(screen.getByRole("button", { name: "先頭ページへ" }));
    await waitFor(() => expect(requestedCursors.at(-1)).toBeNull());
    expect(screen.getByLabelText("current location")).not.toHaveTextContent("cursor=");
  });

  it("offers 10, 25, and 50 as match page sizes", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <LocationProbe />
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    const pageSizeSelect = await screen.findByLabelText("表示件数");
    expect([...pageSizeSelect.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "10",
      "25",
      "50",
    ]);
    expect(pageSizeSelect).toHaveValue("10");

    await user.selectOptions(pageSizeSelect, "25");

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("pageSize=25"),
    );
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

    await waitFor(() => expect(screen.getAllByRole("button", { name: "確認中…" })).toHaveLength(2));
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

  it("opens master management from manual creation with return handoff", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/new"]}>
          <Routes>
            <Route
              path="/matches/new"
              element={
                <>
                  <LocationProbe />
                  <MatchCreatePage />
                </>
              }
            />
            <Route
              path="/admin/masters"
              element={
                <>
                  <LocationProbe />
                  <p>masters</p>
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合の新規作成" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "設定管理へ" }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("/admin/masters"),
    );
    expect(screen.getByLabelText("current location")).toHaveTextContent(
      "returnTo=%2Fmatches%2Fnew",
    );
    expect(screen.getByLabelText("current location")).toHaveTextContent("handoffId=");
  });

  it("returns manual creation to its source context", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/new?returnTo=%2Fheld-events%2Fheld-1"]}>
          <Routes>
            <Route path="/matches/new" element={<MatchCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("link", { name: "入力をやめる" })).toHaveAttribute(
      "href",
      "/held-events/held-1",
    );
  });

  it("prefills the requested held event with its server-supplied next match number", async () => {
    setDevUser();
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({
          items: [
            {
              draftCount: 0,
              heldAt: "2026-02-01T00:00:00.000Z",
              id: "held-latest",
              matchCount: 1,
              nextMatchNo: 2,
            },
          ],
        }),
      ),
      http.get("/api/held-events/:heldEventId", ({ params }) =>
        HttpResponse.json({
          draftCount: 2,
          drafts: [],
          heldAt: "2026-01-01T00:00:00.000Z",
          id: String(params["heldEventId"]),
          matchCount: 3,
          matches: [],
          nextMatchNo: 8,
        }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/new?heldEventId=%20held-requested%20"]}>
          <Routes>
            <Route path="/matches/new" element={<MatchCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合の新規作成" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText(/開催履歴/u)).toHaveValue("held-requested");
      expect(screen.getByLabelText("試合番号")).toHaveValue("8");
    });
  });

  it("trims match draft deep link ids before loading draft details", async () => {
    setDevUser();
    let requestedDraftId = "";
    server.use(
      http.get("/api/match-drafts/:draftId", ({ params }) => {
        requestedDraftId = String(params["draftId"]);
        return HttpResponse.json({
          createdAt: "2026-01-01T00:00:00.000Z",
          matchDraftId: requestedDraftId,
          status: "needs_review",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/new?matchDraftId=%20draft-trimmed%20"]}>
          <Routes>
            <Route path="/matches/new" element={<MatchCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合の新規作成" })).toBeInTheDocument();
    await waitFor(() => expect(requestedDraftId).toBe("draft-trimmed"));
  });

  it("does not restore manual creation values from a foreign handoff session", async () => {
    setDevUser();
    const handoffId = saveMasterHandoff(
      createMatchWorkspaceMasterHandoffPayload({
        matchSessionId: "foreign-session",
        returnTo: "/matches/new",
        values: makeMatchWorkspaceMasterHandoffValues({ matchNoInEvent: 9 }),
      }),
    );
    if (!handoffId) {
      throw new Error("expected handoff to be saved");
    }

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/matches/new?handoffId=${handoffId}`]}>
          <Routes>
            <Route
              path="/matches/new"
              element={
                <>
                  <LocationProbe />
                  <MatchCreatePage />
                </>
              }
            />
          </Routes>
          <ToastHost />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("設定管理から戻りましたが、入力内容を復元できませんでした。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("設定管理から戻ったため、入力内容を復元しました。"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("試合番号")).not.toHaveValue("9");
    expect(screen.getByLabelText("current location")).toHaveTextContent("/matches/new");
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).not.toHaveTextContent("handoffId="),
    );
  });

  it("shows a held-event API failure beside the creation operation", async () => {
    setDevUser();
    server.use(
      http.post("/api/held-events", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/new"]}>
          <Routes>
            <Route path="/matches/new" element={<MatchCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合の新規作成" })).toBeInTheDocument();
    const eventDisclosure = screen.getByText("一覧にない開催履歴を追加する");
    await user.click(eventDisclosure);
    await user.click(screen.getByRole("button", { name: "作成して選択" }));

    const failure = await screen.findByRole("heading", { name: "開催履歴を追加できませんでした" });
    const notice = failure.closest("section");
    expect(notice).toHaveTextContent("試合条件も変更していません");
    expect(notice).toHaveTextContent("もう一度作成してください");
    expect(screen.getByRole("button", { name: "作成して選択" })).toBeEnabled();
  });
});

describe("MatchEditPage", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("starts the match detail and independent directories before any directory resolves", async () => {
    setDevUser();
    const directoryGate = createDeferred();
    const requested = new Set<string>();
    server.use(
      http.get("/api/held-events", async () => {
        requested.add("held-events");
        await directoryGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/game-titles", async () => {
        requested.add("game-titles");
        await directoryGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/member-aliases", async () => {
        requested.add("member-aliases");
        await directoryGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/matches/:matchId", ({ params }) => {
        requested.add("match-detail");
        return HttpResponse.json(makeMatchDetail({ matchId: String(params["matchId"]) }));
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(requested).toEqual(
        new Set(["held-events", "game-titles", "member-aliases", "match-detail"]),
      ),
    );
    directoryGate.resolve();
    expect(await screen.findByRole("heading", { name: "試合を編集" })).toBeInTheDocument();
  });

  it("shows a structured loading shell while the saved match is loading", async () => {
    setDevUser();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/matches/:matchId", async ({ params }) => {
        await responseGate.promise;
        return HttpResponse.json({
          createdAt: "2026-01-01T00:00:00.000Z",
          createdByMemberId: "member_ponta",
          gameTitleId: "gt_momotetsu_2",
          heldEventId: "held-1",
          layoutFamily: "momotetsu_2",
          mapMasterId: "map_east",
          matchId: params["matchId"],
          matchNoInEvent: 1,
          ownerMemberId: "member_ponta",
          playedAt: "2026-01-01T00:00:00.000Z",
          players: [
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_ponta",
              playOrder: 1,
              rank: 1,
              revenueManYen: 200,
              totalAssetsManYen: 1000,
            },
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_akane_mami",
              playOrder: 2,
              rank: 2,
              revenueManYen: 150,
              totalAssetsManYen: 800,
            },
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_otaka",
              playOrder: 3,
              rank: 3,
              revenueManYen: 100,
              totalAssetsManYen: 600,
            },
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_eu",
              playOrder: 4,
              rank: 4,
              revenueManYen: 50,
              totalAssetsManYen: 400,
            },
          ],
          seasonMasterId: "season_current",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/matches/match-1/edit?returnTo=%2Fmatches%3Fcursor%3Dcursor-2"]}
        >
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText("試合編集を読み込み中")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "試合編集を読み込み中" })).toBeInTheDocument();

    responseGate.resolve();
    expect(await screen.findByRole("heading", { name: "試合を編集" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "編集をやめる" })).toHaveAttribute(
      "href",
      "/matches?cursor=cursor-2",
    );
  });

  it("makes retry the primary action when the saved match cannot be loaded", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false } });
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("試合編集を読み込めませんでした")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "試合編集を再読み込み" });
    expect(retry).toHaveClass("bg-[var(--color-action)]");
  });

  it("keeps edited values and shows an update API failure in the execution area", async () => {
    setDevUser();
    server.use(
      http.put("/api/matches/:matchId", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合を編集" })).toBeInTheDocument();
    const matchNumber = screen.getByLabelText("試合番号");
    expect(matchNumber).toHaveValue("1");
    await user.click(screen.getByRole("button", { name: "保存" }));

    const failure = await screen.findByRole("heading", { name: "変更を保存できませんでした" });
    expect(failure.closest("section")).toHaveTextContent("入力内容は保持しています");
    expect(matchNumber).toHaveValue("1");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });
});

describe("MatchDetailPage", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("shows delete confirmation modal when 削除 clicked", async () => {
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
    expect(screen.queryByText("今日の主役")).not.toBeInTheDocument();
    expect(screen.queryByText("優勝")).not.toBeInTheDocument();
    const resultLedger = screen.getByRole("list", { name: "試合の順位と成績" });
    expect(resultLedger).toBeInTheDocument();
    const resultLedgerRegion = screen.getByRole("region", { name: "順位・総資産" });
    expect(resultLedgerRegion).toHaveClass("w-full");
    expect(resultLedgerRegion).toContainElement(resultLedger);
    const detailTable = screen.getByRole("table", { name: "試合結果" });
    expect(detailTable.querySelectorAll("[data-member-sequence]")).toHaveLength(4);
    expect(detailTable.querySelectorAll("[data-play-order]")).toHaveLength(4);
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

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("/held-events/held-1"),
    );
    expect(screen.getByText("held-event-page")).toBeInTheDocument();
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
    const seriesFeature = screen.getByText("同条件内").closest("li");
    expect(seriesFeature).toHaveClass("border-[var(--color-analysis-emphasis)]/35");
    expect(seriesFeature).not.toHaveClass("border-[var(--color-action)]/35");
    const contextParams = new URLSearchParams(contextSearches.at(-1));
    expect(contextParams.get("artifactId")).toBe("artifact-current");
    expect(contextParams.get("gameTitleId")).toBe("gt_momotetsu_2");
    expect(contextParams.get("seasonMasterId")).toBe("season_current");
    expect(contextParams.get("mapMasterId")).toBe("map_east");
    expect(contextParams.get("matchId")).toBe("match-1");
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
    expect(screen.getByRole("list", { name: "試合の順位と成績" }).children).toHaveLength(4);
    expect(screen.getAllByText("比較データなし")).toHaveLength(4);
    expect(screen.queryByText("1.82 → 1.75")).not.toBeInTheDocument();
  });
});
