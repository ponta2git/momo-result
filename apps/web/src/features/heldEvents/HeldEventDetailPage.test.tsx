import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { HeldEventDetailPage } from "@/features/heldEvents/HeldEventDetailPage";
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

  it("connects one held event to its draft, player recap, results, and comparison", async () => {
    server.use(
      http.get("/api/held-events/:heldEventId", () =>
        HttpResponse.json(
          makeHeldEventDetailResponse({
            draftCount: 1,
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
            ],
            matchCount: 1,
            matches: [
              {
                gameTitleId: "gt_momotetsu_2",
                mapMasterId: "map_east",
                matchId: "match-1",
                matchNoInEvent: 1,
                ownerMemberId: "member_ponta",
                playedAt: "2026-01-01T00:00:00.000Z",
                players: [
                  {
                    memberId: "member_ponta",
                    playOrder: 1,
                    rank: 1,
                    revenueManYen: 100,
                    totalAssetsManYen: 12_345,
                  },
                  {
                    memberId: "member_eu",
                    playOrder: 2,
                    rank: 2,
                    revenueManYen: 90,
                    totalAssetsManYen: 9_000,
                  },
                ],
                seasonMasterId: "season_current",
              },
            ],
            nextMatchNo: 3,
          }),
        ),
      ),
    );

    renderPage();

    expect(await screen.findByRole("heading", { name: "この開催の戦績" })).toBeInTheDocument();
    expect(await screen.findAllByText("桃太郎電鉄2 / 今シーズン / 東日本編")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "確認事項を直す" })).toHaveAttribute(
      "href",
      "/review/draft-review-1?returnTo=%2Fheld-events%2Fheld-1",
    );
    expect(screen.getByRole("region", { name: "ぽんたの開催戦績" })).toHaveTextContent("1勝");
    const results = screen.getByRole("list", { name: "第1試合の順位と総資産" });
    expect(within(results).getByText("1億2345万円")).toBeInTheDocument();
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
    expect(screen.getByText("第3試合")).toBeInTheDocument();
  });

  it("offers event-scoped capture actions before the first confirmed match", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "確定済みの試合はまだありません" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "OCR取り込み" })[0]).toHaveAttribute(
      "href",
      "/ocr/new?heldEventId=held-1&returnTo=%2Fheld-events%2Fheld-1",
    );
    expect(screen.getAllByRole("link", { name: "手入力" })[0]).toHaveAttribute(
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

    expect(await screen.findByText("開催履歴が見つかりません")).toBeInTheDocument();
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
});
