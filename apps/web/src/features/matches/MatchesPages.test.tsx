import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { formatCompactDateTime } from "@/features/matches/list/matchListFormat";
import { MatchCreatePage } from "@/features/matches/MatchCreatePage";
import { MatchDetailPage } from "@/features/matches/MatchDetailPage";
import { MatchEditPage } from "@/features/matches/MatchEditPage";
import { MatchesListPage } from "@/features/matches/MatchesListPage";
import {
  createMatchWorkspaceMasterHandoffPayload,
  saveMasterHandoff,
} from "@/shared/workflows/matchWorkspaceMasterHandoff";
import { createDeferred } from "@/test/deferred";
import { makeFourPlayerResults, makeIncidents, makeMatchDetail } from "@/test/factories";
import { makeMatchWorkspaceMasterHandoffValues } from "@/test/factories/draftReview";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesComparisonResponse } from "@/test/msw/seriesComparisonHandlers";
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
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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
    expect(screen.queryByLabelText("開催の振り返り")).not.toBeInTheDocument();
    expect(await screen.findAllByText("優勝 ぽんた")).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: /開催・試合/u })).toBeInTheDocument();
    const matchInfoCell = screen.getAllByRole("cell").find((cell) => {
      const text = cell.textContent ?? "";
      return [
        formatCompactDateTime("2026-01-01T00:00:00.000Z"),
        "桃太郎電鉄2",
        "今シーズン",
        "第1試合",
        "東日本編",
      ].every((part) => text.includes(part));
    });
    expect(matchInfoCell).toBeDefined();
    const detailLinks = await screen.findAllByRole("link", { name: "詳細を見る" });
    expect(detailLinks).toHaveLength(2);
    detailLinks.forEach((link) => expect(link).toHaveAttribute("href", "/matches/match-1"));
  });

  it("commits detail navigation immediately while the detail payload is loading", async () => {
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

    const detailLinks = await screen.findAllByRole("link", { name: "詳細を見る" });
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
    expect(screen.getByRole("heading", { name: "試合詳細を読み込み中" })).toBeInTheDocument();
    await waitFor(() => expect(detailRequested).toBe(true));

    detailGate.resolve();
    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
  });

  it("shows empty-list state below the filter section", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
    const filterSection = screen.getByText("表示条件").closest("section");
    const workQueueSection = screen.getByText("未完了タスク").closest("section");
    if (!filterSection || !workQueueSection) {
      throw new Error("expected filter and work queue sections to be present");
    }
    expect(filterSection.compareDocumentPosition(workQueueSection)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("preserves selected held-event filter in URL after submitting", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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
    await waitFor(() => expect(heldEventSelect.options.length).toBeGreaterThan(1));

    await user.selectOptions(heldEventSelect, "held-1");

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("heldEventId=held-1"),
    );
  });

  it("applies sort changes to the URL search params", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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

  it("corrects an out-of-range list page before showing an empty-list state", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const items = [
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
      http.get("/api/matches", ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get("page") ?? "1");
        const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
        const offset = (page - 1) * pageSize;
        return HttpResponse.json({
          items: items.slice(offset, offset + pageSize),
          pagination: {
            hasNextPage: false,
            hasPreviousPage: page > 1,
            page,
            pageSize,
            totalItems: items.length,
            totalPages: 1,
          },
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches?page=99"]}>
          <LocationProbe />
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
            <Route path="/matches/:matchId" element={<p>detail-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合一覧" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("/matches"),
    );
    const detailLinks = await screen.findAllByRole("link", { name: "詳細を見る" });
    detailLinks.forEach((link) => expect(link).toHaveAttribute("href", "/matches/match-1"));
    expect(screen.queryByText("試合はまだありません")).not.toBeInTheDocument();
  });

  it("shows optimistic status selection while the filtered list is refetching", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
    const needsReviewButton = await screen.findByRole("button", { name: /要確認/u });

    await user.click(needsReviewButton);

    expect(needsReviewButton).toHaveAttribute("aria-pressed", "true");
    expect(needsReviewButton).toBeDisabled();
    expect(screen.getByText("条件を反映中")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認事項を直す" })).not.toBeInTheDocument();
    await waitFor(() => expect(needsReviewRequested).toBe(true));

    responseGate.resolve();
    await waitFor(() =>
      screen
        .getAllByRole("button", { name: "確認事項を直す" })
        .forEach((button) => expect(button).toBeEnabled()),
    );
  });

  it("checks a draft action before navigation and redirects to detail when already confirmed", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "確認中…" })).not.toHaveLength(0),
    );
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
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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

  it("does not restore manual creation values from a foreign handoff session", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
    expect(screen.getByLabelText("current location")).not.toHaveTextContent("handoffId=");
  });
});

describe("MatchEditPage", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("shows a structured loading shell while the saved match is loading", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
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
  });
});

describe("MatchDetailPage", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("shows delete confirmation modal when 削除 clicked", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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
    expect(screen.getByText("優勝")).toBeInTheDocument();

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

  it("shows match feature badges from the match record and same-series comparison", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
      http.get("/api/analytics/series-comparison", () =>
        HttpResponse.json({
          ...makeSeriesComparisonResponse(),
          matchTimeline: [
            {
              assetGapFirstToLast: 1100,
              assetGapFirstToSecond: 100,
              flags: ["close_finish"],
              matchId: "match-1",
              matchIndex: 1,
              playedAt: "2026-04-04T12:34:56.000Z",
              revenueTopMemberIds: ["member_ponta"],
              status: "ok",
              totalGinjiCount: 0,
              winnerMemberId: "member_akane_mami",
            },
          ],
        }),
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

    expect(await screen.findByRole("heading", { name: "試合の特徴" })).toBeInTheDocument();
    expect(await screen.findByText("接戦")).toBeInTheDocument();
    expect(screen.getByText("物件収益ねじれ")).toBeInTheDocument();
    expect(screen.getByText("スリの銀次多発")).toBeInTheDocument();
    expect(screen.getByText("借金あり")).toBeInTheDocument();
    expect(screen.getByText("目的地なし決着")).toBeInTheDocument();
    expect(screen.getByText("低収益勝ち")).toBeInTheDocument();
    expect(screen.getByText("同作品内")).toBeInTheDocument();
    expect(screen.getAllByText("試合記録").length).toBeGreaterThan(0);
  });

  it("keeps match-record badges visible when series comparison loading fails", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
      http.get("/api/analytics/series-comparison", () =>
        HttpResponse.json({ title: "series unavailable" }, { status: 500 }),
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

    expect(await screen.findByRole("heading", { name: /第1試合の結果/u })).toBeInTheDocument();
    expect(await screen.findByText("物件収益ねじれ")).toBeInTheDocument();
    expect(screen.getByText("試合単体の記録から判定しています")).toBeInTheDocument();
    expect(screen.queryByText("接戦")).not.toBeInTheDocument();
  });
});
