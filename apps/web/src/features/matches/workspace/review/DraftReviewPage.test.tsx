import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { confirmedDraftMessages } from "@/features/matches/confirmedDraftNavigation";
import { DraftReviewPage } from "@/features/matches/workspace/DraftReviewPage";
import { matchWorkspaceSessionDraftKey } from "@/features/matches/workspace/matchWorkspaceSessionDraft";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import {
  createMatchWorkspaceMasterHandoffPayload,
  saveMasterHandoff,
} from "@/shared/workflows/matchWorkspaceMasterHandoff";
import { setDevUser, testDevUserAccountId } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import {
  makeHeldEventResponse,
  makeMatchWorkspaceMasterHandoffValues,
  makeFourReviewPlayerInputs,
} from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

function matchDraftDetailResponse(
  draftId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    gameTitleId: "gt_momotetsu_2",
    heldEventId: "held-1",
    incidentLogDraftId: `${draftId}-incident`,
    incidentLogImageId: `${draftId}-img-incident`,
    mapMasterId: "map_east",
    matchDraftId: draftId,
    matchNoInEvent: 3,
    ownerMemberId: "member_ponta",
    playedAt: "2026-01-01T00:00:00.000Z",
    revenueDraftId: `${draftId}-revenue`,
    revenueImageId: `${draftId}-img-revenue`,
    seasonMasterId: "season_current",
    status: "needs_review",
    totalAssetsDraftId: `${draftId}-total`,
    totalAssetsImageId: `${draftId}-img-total`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function waitForSampleWorkspaceReady() {
  expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
  expect(screen.getByText("サンプルの読み取り結果で表示中")).toBeInTheDocument();
}

describe("DraftReviewPage", () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("loads OCR drafts and opens confirmation after validation passes", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/session-1?totalAssets=draft-1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
            <Route path="/ocr/new" element={<p>取り込みコンソール</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("あかねまみ")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "開催（必須）を変更" }));
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("value", "held-1");
    await user.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));

    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
    expect(
      await screen.findByRole("heading", { name: "この内容で確定しますか？" }),
    ).toBeInTheDocument();
  });

  it("keeps setup, player, incident, review, and persistence models wired to one submission", async () => {
    setDevUser();
    let submitted: unknown;
    server.use(
      http.post("/api/matches", async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json({
          createdAt: "2026-01-01T00:00:00.000Z",
          heldEventId: "held-1",
          matchId: "match-grouped-model",
          matchNoInEvent: 8,
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/session-grouped-model"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
            <Route path="/matches/:matchId" element={<p>試合詳細</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    const matchNumber = screen.getByLabelText("試合番号");
    await user.clear(matchNumber);
    await user.type(matchNumber, "8");

    const assets = screen.getByLabelText("ぽんた 総資産（万円）");
    await user.clear(assets);
    await user.type(assets, "23456");
    await user.tab();

    const plusStations = screen.getByLabelText("ぽんた プラス駅");
    await user.clear(plusStations);
    await user.type(plusStations, "12");
    await user.tab();

    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
    const dialog = await screen.findByRole("dialog", { name: "この内容で確定しますか？" });
    expect(within(dialog).getByText("第8試合")).toBeInTheDocument();
    expect(within(dialog).getByRole("cell", { name: "23,456" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "確定する" }));
    await waitFor(() =>
      expect(submitted).toMatchObject({
        matchDraftId: "session-grouped-model",
        matchNoInEvent: 8,
        players: expect.arrayContaining([
          expect.objectContaining({
            incidents: expect.objectContaining({ plusStation: 12 }),
            memberId: "member_ponta",
            totalAssetsManYen: 23_456,
          }),
        ]),
      }),
    );
  });

  it("redirects to the confirmed match when the draft is already confirmed on load", async () => {
    setDevUser();
    server.use(
      http.get("/api/match-drafts/:draftId", ({ params }) =>
        HttpResponse.json(
          matchDraftDetailResponse(String(params["draftId"]), {
            confirmedMatchId: "match-confirmed-1",
            status: "confirmed",
          }),
        ),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/draft-confirmed-1"]}>
          <ToastHost />
          <LocationProbe />
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
            <Route path="/matches/:matchId" element={<p>試合詳細</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "/matches/match-confirmed-1",
      ),
    );
    expect(await screen.findAllByText(confirmedDraftMessages.loadRedirect)).toHaveLength(1);
  });

  it("checks the latest draft before confirmation and skips POST when already confirmed", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 10_000 } });
    let draftDetailRequests = 0;
    let postCalled = false;
    server.use(
      http.get("/api/match-drafts/:draftId", ({ params }) => {
        draftDetailRequests += 1;
        const draftId = String(params["draftId"]);
        return HttpResponse.json(
          matchDraftDetailResponse(
            draftId,
            draftDetailRequests >= 2
              ? {
                  confirmedMatchId: "match-confirmed-before-submit",
                  status: "confirmed",
                }
              : {},
          ),
        );
      }),
      http.post("/api/matches", async () => {
        postCalled = true;
        return HttpResponse.json({
          createdAt: "2026-01-01T00:00:00.000Z",
          heldEventId: "held-1",
          matchId: "unexpected-match",
          matchNoInEvent: 3,
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/draft-race-before-submit"]}>
          <ToastHost />
          <LocationProbe />
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
            <Route path="/matches/:matchId" element={<p>試合詳細</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
    await user.click(await screen.findByRole("button", { name: "確定する" }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "/matches/match-confirmed-before-submit",
      ),
    );
    expect(postCalled).toBe(false);
    expect(await screen.findAllByText(confirmedDraftMessages.confirmConflict)).toHaveLength(1);
  });

  it("keeps the confirmation dialog busy while the latest draft status is unresolved", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 10_000 } });
    const preflightStarted = createDeferred();
    const preflightGate = createDeferred();
    let draftDetailRequests = 0;
    server.use(
      http.get("/api/match-drafts/:draftId", async ({ params }) => {
        draftDetailRequests += 1;
        if (draftDetailRequests >= 2) {
          preflightStarted.resolve();
          await preflightGate.promise;
        }
        return HttpResponse.json(matchDraftDetailResponse(String(params["draftId"])));
      }),
      http.post("/api/matches", () =>
        HttpResponse.json({
          createdAt: "2026-01-01T00:00:00.000Z",
          heldEventId: "held-1",
          matchId: "match-after-preflight",
          matchNoInEvent: 3,
        }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/draft-pending-preflight"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
            <Route path="/matches/:matchId" element={<p>試合詳細</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
    const dialog = await screen.findByRole("dialog", { name: "この内容で確定しますか？" });
    await user.click(within(dialog).getByRole("button", { name: "確定する" }));
    await preflightStarted.promise;

    expect(within(dialog).getByRole("button", { name: "戻って修正" })).toBeDisabled();
    const pendingConfirmButton = within(dialog).getByRole("button", { name: "確定中…" });
    expect(pendingConfirmButton).toBeDisabled();
    expect(pendingConfirmButton).toHaveAttribute("aria-busy", "true");
    expect(
      within(dialog).queryByRole("button", { name: "ダイアログを閉じる" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();

    preflightGate.resolve();
    expect(await screen.findByText("試合詳細")).toBeInTheDocument();
  });

  it("redirects after a confirm conflict when the draft was confirmed concurrently", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 10_000 } });
    let draftDetailRequests = 0;
    let postCalled = false;
    server.use(
      http.get("/api/match-drafts/:draftId", ({ params }) => {
        draftDetailRequests += 1;
        const draftId = String(params["draftId"]);
        return HttpResponse.json(
          matchDraftDetailResponse(
            draftId,
            draftDetailRequests >= 3
              ? {
                  confirmedMatchId: "match-confirmed-after-conflict",
                  status: "confirmed",
                }
              : {},
          ),
        );
      }),
      http.post("/api/matches", async () => {
        postCalled = true;
        return HttpResponse.json(
          {
            code: "CONFLICT",
            detail: "Failed to confirm match from the draft.",
            status: 409,
            title: "Conflict",
            type: "about:blank",
          },
          { status: 409 },
        );
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/draft-race-after-post"]}>
          <ToastHost />
          <LocationProbe />
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
            <Route path="/matches/:matchId" element={<p>試合詳細</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
    await user.click(await screen.findByRole("button", { name: "確定する" }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "/matches/match-confirmed-after-conflict",
      ),
    );
    expect(postCalled).toBe(true);
    expect(await screen.findAllByText(confirmedDraftMessages.confirmConflict)).toHaveLength(1);
  });

  it("returns status check failures to persistent execution feedback", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 10_000 } });
    let draftDetailRequests = 0;
    server.use(
      http.get("/api/match-drafts/:draftId", ({ params }) => {
        draftDetailRequests += 1;
        if (draftDetailRequests >= 2) {
          return HttpResponse.json(
            {
              code: "INTERNAL_SERVER_ERROR",
              status: 500,
              title: "Internal Server Error",
              type: "about:blank",
            },
            { status: 500 },
          );
        }
        return HttpResponse.json(matchDraftDetailResponse(String(params["draftId"])));
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/draft-status-check-fails"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
    const dialog = await screen.findByRole("dialog", { name: "この内容で確定しますか？" });
    await user.click(within(dialog).getByRole("button", { name: "確定する" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "この内容で確定しますか？" }),
      ).not.toBeInTheDocument(),
    );
    const executionArea = screen.getByRole("region", { name: "入力内容の確定" });
    expect(within(executionArea).getByRole("alert")).toHaveTextContent(
      confirmedDraftMessages.statusCheckFailed,
    );
    expect(within(executionArea).getByRole("alert")).toHaveTextContent(
      "もう一度確定を実行してください",
    );
  });

  it("returns a confirmation API failure to persistent execution feedback", async () => {
    setDevUser();
    server.use(
      http.post("/api/matches", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/session-confirm-fails"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
    await user.click(await screen.findByRole("button", { name: "確定する" }));

    expect(
      await screen.findByRole("heading", { name: "試合を確定できませんでした" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "この内容で確定しますか？" }),
    ).not.toBeInTheDocument();
    const executionArea = screen.getByRole("region", { name: "入力内容の確定" });
    expect(within(executionArea).getByRole("alert")).toHaveTextContent("入力内容は保持しています");
    await waitFor(() =>
      expect(
        within(executionArea).getByRole("button", { name: "確定前の確認へ進む" }),
      ).toBeEnabled(),
    );
  });

  it("returns a draft-delete API failure to persistent execution feedback", async () => {
    setDevUser();
    server.use(
      http.post("/api/match-drafts/:draftId/cancel", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/session-delete-fails"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確定前の記録を削除" }));
    await user.click(await screen.findByRole("button", { name: "削除する" }));

    expect(
      await screen.findByRole("heading", { name: "確定前の記録を削除できませんでした" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "確定前の記録を削除しますか？" }),
    ).not.toBeInTheDocument();
    const deleteFailure = screen
      .getByRole("heading", { name: "確定前の記録を削除できませんでした" })
      .closest("section");
    expect(deleteFailure).toHaveAttribute("role", "alert");
    expect(deleteFailure).toHaveTextContent("確定前の記録と入力内容は残っています");
    const executionArea = screen.getByRole("region", { name: "入力内容の確定" });
    expect(within(executionArea).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the review form unavailable until the draft summary has loaded", async () => {
    setDevUser();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/match-drafts/:draftId", async ({ params }) => {
        await responseGate.promise;
        const draftId = String(params["draftId"]);
        return HttpResponse.json({
          createdAt: "2026-01-01T00:00:00.000Z",
          gameTitleId: "gt_momotetsu_2",
          heldEventId: "held-1",
          incidentLogDraftId: `${draftId}-incident`,
          incidentLogImageId: `${draftId}-img-incident`,
          mapMasterId: "map_east",
          matchDraftId: draftId,
          matchNoInEvent: 3,
          ownerMemberId: "member_ponta",
          playedAt: "2026-01-01T00:00:00.000Z",
          revenueDraftId: `${draftId}-revenue`,
          revenueImageId: `${draftId}-img-revenue`,
          seasonMasterId: "season_current",
          status: "needs_review",
          totalAssetsDraftId: `${draftId}-total`,
          totalAssetsImageId: `${draftId}-img-total`,
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/session-delayed"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText("OCR結果を読み込み中")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "OCR結果を読み込み中" }).closest("header"),
    ).toHaveTextContent(
      "読み取り結果を確認して、開催と4人分の結果を確定します。現在の状態: 状態不明",
    );
    expect(screen.queryByRole("button", { name: "確定前の確認へ進む" })).not.toBeInTheDocument();

    responseGate.resolve();
    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "確定前の確認へ進む" })).toBeEnabled();
  });

  it("returns to the loading shell when navigating to another review session", async () => {
    setDevUser();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/match-drafts/:draftId", async ({ params }) => {
        const draftId = String(params["draftId"]);
        if (draftId === "session-next") {
          await responseGate.promise;
        }
        return HttpResponse.json({
          createdAt: "2026-01-01T00:00:00.000Z",
          gameTitleId: "gt_momotetsu_2",
          heldEventId: "held-1",
          incidentLogDraftId: `${draftId}-incident`,
          incidentLogImageId: `${draftId}-img-incident`,
          mapMasterId: "map_east",
          matchDraftId: draftId,
          matchNoInEvent: 3,
          ownerMemberId: "member_ponta",
          playedAt: "2026-01-01T00:00:00.000Z",
          revenueDraftId: `${draftId}-revenue`,
          revenueImageId: `${draftId}-img-revenue`,
          seasonMasterId: "season_current",
          status: "needs_review",
          totalAssetsDraftId: `${draftId}-total`,
          totalAssetsImageId: `${draftId}-img-total`,
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/session-1"]}>
          <Link to="/review/session-next">別の確認へ</Link>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "別の確認へ" }));

    expect(await screen.findByLabelText("OCR結果を読み込み中")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByRole("button", { name: "確定前の確認へ進む" })).not.toBeInTheDocument();

    responseGate.resolve();
    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
  });

  it("resets review progress while keeping each review session draft isolated", async () => {
    setDevUser();
    const firstSessionDraftKey = matchWorkspaceSessionDraftKey({
      accountId: testDevUserAccountId,
      mode: "review",
      workspaceKey: "session-1",
    });
    const secondSessionDraftKey = matchWorkspaceSessionDraftKey({
      accountId: testDevUserAccountId,
      mode: "review",
      workspaceKey: "session-2",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/session-1?sample=1"]}>
          <Link to="/review/session-2?sample=1">別の確認へ</Link>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitForSampleWorkspaceReady();
    const initialReviewProgress = screen.getByText(/未確認\d+件／全\d+件/u).textContent;
    const initialMatchNumber = (screen.getByLabelText("試合番号") as HTMLInputElement).value;
    await user.click(screen.getByRole("button", { name: "この値で確認済み" }));
    expect(screen.queryByText(initialReviewProgress ?? "")).not.toBeInTheDocument();

    const matchNumber = screen.getByLabelText("試合番号");
    await user.clear(matchNumber);
    await user.type(matchNumber, "9");
    await user.tab();
    await waitFor(() => expect(window.sessionStorage.getItem(firstSessionDraftKey)).not.toBeNull());

    await user.click(screen.getByRole("link", { name: "別の確認へ" }));

    await waitFor(() => expect(screen.getByLabelText("試合番号")).toHaveValue(initialMatchNumber));
    expect(screen.getByText(initialReviewProgress ?? "")).toBeInTheDocument();
    expect(screen.queryByText("前回の一時保存があります")).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(firstSessionDraftKey)).not.toBeNull();
    expect(window.sessionStorage.getItem(secondSessionDraftKey)).toBeNull();
  });

  it("preserves review input when handoff and return context change in place", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/session-1?sample=1"]}>
          <Link to="/review/session-1?sample=1&handoffId=missing&returnTo=%2Fmatches">
            復元コンテキストを反映
          </Link>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
          <ToastHost />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitForSampleWorkspaceReady();
    const matchNumber = screen.getByLabelText("試合番号");
    await user.clear(matchNumber);
    await user.type(matchNumber, "9");

    await user.click(screen.getByRole("link", { name: "復元コンテキストを反映" }));

    expect(
      await screen.findByText("設定管理から戻りましたが、入力内容を復元できませんでした。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("試合番号")).toHaveValue("9");
  });

  it("keeps held event creation collapsed until requested", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("一覧にない開催を追加する")).toBeInTheDocument();
    expect(screen.getByRole("button", { hidden: true, name: "作成して選択" })).not.toBeVisible();

    await user.click(screen.getByText("一覧にない開催を追加する"));
    expect(screen.getByRole("button", { name: "作成して選択" })).toBeVisible();
  });

  it("announces held event creation and selects the created option", async () => {
    setDevUser();
    const heldEvents = [makeHeldEventResponse()];
    const createdHeldEvent = makeHeldEventResponse({
      heldAt: "2026-01-02T00:00:00.000Z",
      id: "held-created",
    });
    server.use(
      http.get("/api/held-events", () => HttpResponse.json({ items: heldEvents })),
      http.post("/api/held-events", () => {
        heldEvents.unshift(createdHeldEvent);
        return HttpResponse.json(createdHeldEvent);
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
          <ToastHost />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("一覧にない開催を追加する");
    await user.click(screen.getByText("一覧にない開催を追加する"));
    await user.click(screen.getByRole("button", { name: "作成して選択" }));

    await waitFor(() =>
      expect(
        screen.getByText(/2026\/01\/02 09:00 — 確定済み0試合・未確定下書き0件/u),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "開催（必須）を変更" }));
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("value", "held-created");
    expect(
      screen.getByText(
        `開催（${formatDateTimeLong(createdHeldEvent.heldAt)}）を作成して選択しました。`,
      ),
    ).toBeInTheDocument();
  });

  it("renders the development sample drafts without OCR worker data", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitForSampleWorkspaceReady();
    expect(screen.getByRole("heading", { name: "保存先と試合条件" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "4人分の結果を確認・修正" })).toBeInTheDocument();
    expect(screen.getByText("必須条件を設定してください")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "条件を閉じる" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await screen.findByDisplayValue("あかねまみ")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("15420")).toBeInTheDocument();
    expect(screen.queryByText("OCR読み取り状況を確認")).not.toBeInTheDocument();
    expect(screen.queryByText(/緑=高信頼OCR/u)).not.toBeInTheDocument();
    expect(screen.getByText(/Enterキーと矢印キーで移動できます/u)).toBeInTheDocument();
  });

  it("focuses the first invalid field when confirmation cannot open", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitForSampleWorkspaceReady();
    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));

    await waitFor(() => expect(screen.getByRole("combobox", { name: /作品/u })).toHaveFocus());
    expect(
      screen.queryByRole("dialog", { name: "この内容で確定しますか？" }),
    ).not.toBeInTheDocument();
  });

  it("allows clearing and retyping numeric result cells without prefixing zero", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitForSampleWorkspaceReady();
    const rankInput = screen.getByLabelText("ぽんた 順位");

    await user.clear(rankInput);
    expect(rankInput).toHaveValue("");

    await user.type(rankInput, "03");
    expect(rankInput).toHaveValue("3");
    expect(screen.getByText("手修正")).toBeInTheDocument();
  });

  it("offers to restore a tab-scoped draft after the review page is reopened", async () => {
    setDevUser();

    const firstView = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitForSampleWorkspaceReady();
    const rankInput = screen.getByLabelText("ぽんた 順位");
    await user.clear(rankInput);
    await user.type(rankInput, "4");
    await user.tab();
    await waitFor(() => expect(window.sessionStorage.length).toBeGreaterThan(0));
    firstView.unmount();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
          <ToastHost />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("前回の一時保存があります")).toBeInTheDocument();
    expect(screen.getByLabelText("ぽんた 順位")).not.toHaveValue("4");
    await user.click(screen.getByRole("button", { name: "一時保存を復元" }));

    expect(screen.getByLabelText("ぽんた 順位")).toHaveValue("4");
    expect(
      screen.getByText("一時保存した入力内容とOCR確認状況を復元しました。"),
    ).toBeInTheDocument();
  });

  it("restores form values after returning from master management with handoffId", async () => {
    setDevUser();

    const handoffId = saveMasterHandoff(
      createMatchWorkspaceMasterHandoffPayload({
        accountId: testDevUserAccountId,
        matchSessionId: "session-1",
        returnTo: "/review/session-1?sample=1",
        values: makeMatchWorkspaceMasterHandoffValues({
          heldEventId: "held-2",
          matchNoInEvent: 9,
          playedAt: "2026-02-02T02:02:00.000Z",
          players: makeFourReviewPlayerInputs([
            {
              memberId: "member_ponta",
              rank: 4,
              revenueManYen: 777,
              totalAssetsManYen: 8888,
              incidents: {
                cardShop: 3,
                cardStation: 2,
                destination: 1,
                minusStation: 5,
                plusStation: 4,
                suriNoGinji: 6,
              },
            },
            { memberId: "member_akane_mami", rank: 1, revenueManYen: 111, totalAssetsManYen: 2222 },
            { memberId: "member_otaka", rank: 2, revenueManYen: 333, totalAssetsManYen: 4444 },
            { memberId: "member_eu", rank: 3, revenueManYen: 555, totalAssetsManYen: 6666 },
          ]),
        }),
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/review/session-1?sample=1&handoffId=${handoffId}`]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
          <ToastHost />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("設定管理から戻ったため、入力内容を復元しました。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("試合番号")).toHaveValue("9");
    expect(screen.getByLabelText("ぽんた 順位")).toHaveValue("4");
    expect(screen.getByDisplayValue("777")).toBeInTheDocument();
  });
});
