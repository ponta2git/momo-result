import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { HeldEventDetailPage } from "@/features/heldEvents/HeldEventDetailPage";
import { HeldEventDetailLoading } from "@/features/heldEvents/HeldEventDetailStatusViews";
import { setDevUser } from "@/test/auth";
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

describe("HeldEventDetailPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("reserves the leading navigation slot while loading", () => {
    render(<HeldEventDetailLoading />);

    const frame = screen.getByLabelText("開催詳細を読み込み中");
    const heading = screen.getByRole("heading", { name: "開催の記録を読み込み中" });
    expect(frame.children).toHaveLength(3);
    expect(frame.children.item(0)?.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(frame.children.item(1)).toContainElement(heading);
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
    expect(screen.getByText("試合メモ")).toBeInTheDocument();
    expect(screen.getByText("終盤のカード交換で流れが変わった")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第1試合の結果を見る" })).toHaveAttribute(
      "href",
      "/matches/match-1?returnTo=%2Fheld-events%2Fheld-1",
    );
    expect(screen.getByRole("link", { name: "第1試合を戦績比較で見る" })).toHaveAttribute(
      "href",
      "/analytics/series?gameTitleId=gt_momotetsu_2&seasonMasterId=season_current&mapMasterId=map_east&focusMatchId=match-1&view=flow&returnTo=%2Fheld-events%2Fheld-1",
    );
    expect(screen.getByRole("link", { name: "試合検索で見る" })).toHaveAttribute(
      "href",
      "/matches?heldEventId=held-1&sort=match_no_asc&returnTo=%2Fheld-events%2Fheld-1",
    );
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

    expect(await screen.findByText("開催が見つかりません")).toBeInTheDocument();
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

    expect(await screen.findByText("開催詳細を読み込めませんでした")).toBeInTheDocument();
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

  it("uses honest fallback labels and retries failed auxiliary master names in place", async () => {
    let shouldFail = true;
    server.use(
      http.get("/api/game-titles", () =>
        shouldFail
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
            }),
      ),
      http.get("/api/season-masters", () =>
        shouldFail
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
            }),
      ),
      http.get("/api/map-masters", () =>
        shouldFail
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
            }),
      ),
      http.get("/api/held-events/:heldEventId", () =>
        HttpResponse.json(
          makeHeldEventDetailResponse({
            matchCount: 1,
            matches: [
              {
                gameTitleId: "gt_momotetsu_2",
                mapMasterId: "map_east",
                matchId: "match-1",
                matchNoInEvent: 1,
                ownerMemberId: "member_ponta",
                playedAt: "2026-01-01T00:00:00.000Z",
                players: [],
                seasonMasterId: "season_current",
              },
            ],
          }),
        ),
      ),
    );

    renderPage();

    expect(await screen.findByText("表示名を取得できませんでした")).toBeInTheDocument();
    expect(
      screen.getByText(
        /取得済みの表示名はそのまま使い、取得できない箇所だけ「未取得」と表示しています。/u,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("作品名未取得・シーズン名未取得・マップ名未取得")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/gt_|season_|map_/u);
    expect(screen.getByRole("link", { name: "第1試合の結果を見る" })).toBeInTheDocument();

    shouldFail = false;
    await user.click(screen.getByRole("button", { name: "表示名を再取得" }));

    expect(await screen.findByText("桃太郎電鉄2・今シーズン・東日本編")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("表示名を取得できませんでした")).not.toBeInTheDocument(),
    );
  });
});
