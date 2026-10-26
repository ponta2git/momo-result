import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DraftsPage } from "@/features/matches/drafts/DraftsPage";
import type { MatchSummaryResponse } from "@/shared/api/matches";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

function draft(id: string, status: string, matchNoInEvent: number): MatchSummaryResponse {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    gameTitleId: "gt_momotetsu_2",
    hasNote: false,
    heldAt: "2026-01-01T00:00:00.000Z",
    heldEventId: "held-1",
    id,
    kind: "match_draft",
    mapMasterId: "map_east",
    mapName: "東日本編",
    matchDraftId: id,
    matchNoInEvent,
    ownerMemberId: "member_ponta",
    playedAt: "2026-01-01T00:00:00.000Z",
    ranks: [],
    seasonMasterId: "season_current",
    status,
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

let drafts: MatchSummaryResponse[];
let listRequests: URLSearchParams[];

function renderDrafts() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={["/drafts"]}>
        <LocationProbe />
        <Routes>
          <Route path="/drafts" element={<DraftsPage />} />
          <Route path="/review/:draftId" element={<p>review-page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DraftsPage", () => {
  let matchMedia: MatchMediaController;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    setDevUser();
    matchMedia = installMatchMediaController(true);
    user = userEvent.setup();
    drafts = [
      draft("draft-review", "needs_review", 3),
      draft("draft-failed", "ocr_failed", 4),
      draft("draft-running", "ocr_running", 5),
    ];
    listRequests = [];
    server.use(
      http.get("/api/matches", ({ request }) => {
        listRequests.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          items: drafts,
          pagination: {
            hasNextPage: false,
            hasPreviousPage: false,
            page: 1,
            pageSize: 200,
            totalItems: drafts.length,
            totalPages: 1,
          },
        });
      }),
    );
  });

  afterEach(() => {
    matchMedia.restore();
  });

  it("groups unconfirmed drafts by the next thing the reader can do", async () => {
    renderDrafts();

    expect(await screen.findByText("確定前の下書き 3件")).toBeInTheDocument();
    expect(Object.fromEntries(listRequests.at(-1)!)).toMatchObject({
      kind: "match_draft",
      status: "incomplete",
    });
    const action = screen.getByRole("region", { name: "対応が必要 1件" });
    expect(within(action).getByRole("button", { name: "確認事項を直す" })).toBeInTheDocument();
    const failed = screen.getByRole("region", { name: "読み取り失敗 1件" });
    expect(within(failed).getByRole("button", { name: "手入力で続行" })).toBeInTheDocument();
    expect(within(failed).getByRole("button", { name: "破棄" })).toBeInTheDocument();
    const running = screen.getByRole("region", { name: "処理中 1件" });
    expect(within(running).getByRole("button", { name: "読み取りを中止" })).toBeInTheDocument();
  });

  it("checks the draft status before opening the review", async () => {
    renderDrafts();

    await user.click(await screen.findByRole("button", { name: "確認事項を直す" }));

    expect(await screen.findByText("review-page")).toBeInTheDocument();
    expect(screen.getByLabelText("current location")).toHaveTextContent("/review/draft-review");
  });

  it("discards a draft after confirmation and drops it from the refetched groups", async () => {
    const cancelRequests: Request[] = [];
    server.use(
      http.post("/api/match-drafts/:draftId/cancel", ({ params, request }) => {
        cancelRequests.push(request);
        drafts = drafts.filter((item) => item.id !== params["draftId"]);
        return HttpResponse.json({ matchDraftId: params["draftId"], status: "cancelled" });
      }),
    );
    renderDrafts();

    const failed = await screen.findByRole("region", { name: "読み取り失敗 1件" });
    await user.click(within(failed).getByRole("button", { name: "破棄" }));
    const dialog = await screen.findByRole("alertdialog", { name: "下書きを破棄しますか？" });
    expect(cancelRequests).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "破棄する" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "読み取り失敗 1件" })).not.toBeInTheDocument(),
    );
    expect(cancelRequests).toHaveLength(1);
    expect(new URL(cancelRequests[0]!.url).pathname).toBe("/api/match-drafts/draft-failed/cancel");
    expect(cancelRequests[0]!.headers.get("Idempotency-Key")).toBeTruthy();
    expect(screen.getByText("確定前の下書き 2件")).toBeInTheDocument();
  });

  it("keeps the draft and shows the refusal in the dialog when the discard is rejected", async () => {
    server.use(
      http.post("/api/match-drafts/:draftId/cancel", () =>
        HttpResponse.json(
          {
            code: "FORBIDDEN",
            detail: "Only the creator can delete this match draft.",
            status: 403,
            title: "Forbidden",
            type: "about:blank",
          },
          { headers: { "Content-Type": "application/problem+json" }, status: 403 },
        ),
      ),
    );
    renderDrafts();

    const running = await screen.findByRole("region", { name: "処理中 1件" });
    await user.click(within(running).getByRole("button", { name: "読み取りを中止" }));
    const dialog = await screen.findByRole("alertdialog", { name: "読み取りを中止しますか？" });
    await user.click(within(dialog).getByRole("button", { name: "中止する" }));

    expect(await within(dialog).findByRole("alert")).not.toBeEmptyDOMElement();
    // The modal hides the page from the accessibility tree; the row itself must remain.
    expect(screen.getByRole("region", { hidden: true, name: "処理中 1件" })).toBeInTheDocument();
  });

  it("keeps a committed discard when an earlier read is pending and refreshing fails", async () => {
    const earlierRead = createDeferred();
    const earlierReadStarted = createDeferred();
    let failRefresh = false;
    let requestCount = 0;
    server.use(
      http.get("/api/matches", async () => {
        requestCount += 1;
        const items = [...drafts];
        if (requestCount === 2) {
          earlierReadStarted.resolve();
          await earlierRead.promise;
        } else if (failRefresh) {
          return new HttpResponse(null, { status: 503 });
        }
        return HttpResponse.json({
          items,
          pagination: {
            hasNextPage: false,
            hasPreviousPage: false,
            page: 1,
            pageSize: 200,
            totalItems: items.length,
            totalPages: 1,
          },
        });
      }),
      http.post("/api/match-drafts/:draftId/cancel", ({ params }) => {
        drafts = drafts.filter((item) => item.id !== params["draftId"]);
        failRefresh = true;
        return HttpResponse.json({ matchDraftId: params["draftId"], status: "cancelled" });
      }),
    );
    renderDrafts();

    const failed = await screen.findByRole("region", { name: "読み取り失敗 1件" });
    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await earlierReadStarted.promise;
    await user.click(within(failed).getByRole("button", { name: "破棄" }));
    const dialog = await screen.findByRole("alertdialog", { name: "下書きを破棄しますか？" });
    await user.click(within(dialog).getByRole("button", { name: "破棄する" }));

    expect(await screen.findByText("下書きを更新できませんでした")).toBeInTheDocument();
    earlierRead.resolve();
    expect(screen.queryByRole("region", { name: "読み取り失敗 1件" })).not.toBeInTheDocument();
    expect(screen.getByText("確定前の下書き 2件")).toBeInTheDocument();

    failRefresh = false;
    await user.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() =>
      expect(screen.queryByText("下書きを更新できませんでした")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("確定前の下書き 2件")).toBeInTheDocument();
  });
});
