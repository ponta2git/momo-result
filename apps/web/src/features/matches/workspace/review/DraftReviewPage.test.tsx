import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { confirmedDraftMessages } from "@/features/matches/confirmedDraftNavigation";
import { DraftReviewPage } from "@/features/matches/workspace/DraftReviewPage";
import { matchWorkspaceSessionDraftKey } from "@/features/matches/workspace/matchWorkspaceSessionDraft";
import { matchKeys } from "@/shared/api/queryKeys";
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
import { makeMatchDraftReviewResponse } from "@/test/factories/matchDraftReview";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

async function waitForReviewWorkspaceReady() {
  expect(await screen.findByRole("button", { name: "開催（必須）を変更" })).toBeEnabled();
}

async function waitForSampleWorkspaceReady() {
  await waitForReviewWorkspaceReady();
  expect(screen.getByText("サンプルの読み取り結果で表示中")).toBeInTheDocument();
}

describe("DraftReviewPage", () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("keeps OCR warnings unresolved when navigating away from unchanged numeric values", async () => {
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
    const rail = screen.getByLabelText("OCRの確認項目");
    await user.click(within(rail).getByRole("button", { name: "次の要確認セルへ" }));
    await user.click(within(rail).getByRole("button", { name: "次の要確認セルへ" }));
    expect(screen.getByRole("textbox", { name: "おーたか 順位" })).toHaveFocus();
    await user.click(within(rail).getByRole("button", { name: "前の要確認セルへ" }));
    expect(within(rail).getByText("未確認2件／全2件")).toBeInTheDocument();
    await user.click(within(rail).getByRole("button", { name: "次の要確認セルへ" }));
    expect(screen.getByRole("textbox", { name: "おーたか 順位" })).toHaveValue("3");
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

    await waitForReviewWorkspaceReady();
    expect(
      await screen.findByRole("combobox", { name: "あかねまみ メンバー" }),
    ).toBeInTheDocument();
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

    await waitForReviewWorkspaceReady();
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
    expect(await screen.findByText("試合詳細")).toBeInTheDocument();
  });

  it("redirects to the confirmed match when the draft is already confirmed on load", async () => {
    setDevUser();
    server.use(
      http.get("/api/match-drafts/:draftId/review", ({ params }) =>
        HttpResponse.json(
          makeMatchDraftReviewResponse(String(params["draftId"]), {
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

  it("loads one review snapshot and confirms without separate detail, OCR, or image-list reads", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 10_000 } });
    let reviewReads = 0;
    let separateReads = 0;
    let postCount = 0;
    server.use(
      http.get("/api/match-drafts/:draftId/review", ({ params }) => {
        reviewReads += 1;
        return HttpResponse.json(makeMatchDraftReviewResponse(String(params["draftId"])));
      }),
      http.get("/api/match-drafts/:draftId", () => {
        separateReads += 1;
        return HttpResponse.error();
      }),
      http.get("/api/ocr-drafts", () => {
        separateReads += 1;
        return HttpResponse.error();
      }),
      http.get("/api/match-drafts/:draftId/source-images", () => {
        separateReads += 1;
        return HttpResponse.error();
      }),
      http.post("/api/matches", () => {
        postCount += 1;
        return HttpResponse.json({
          createdAt: "2026-01-01T00:00:00Z",
          heldEventId: "held-1",
          matchId: "match-confirmed",
          matchNoInEvent: 3,
        });
      }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/snapshot"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
            <Route path="/matches/:matchId" element={<p>試合詳細</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitForReviewWorkspaceReady();
    expect(reviewReads).toBe(1);
    expect(separateReads).toBe(0);
    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
    await user.click(await screen.findByRole("button", { name: "確定する" }));
    expect(await screen.findByText("試合詳細")).toBeInTheDocument();
    expect(postCount).toBe(1);
    expect(separateReads).toBe(0);
  });

  it("keeps input and the same mutation key when a confirmation response is lost", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 10_000 } });
    const keys: Array<string | null> = [];
    const requests: unknown[] = [];
    let recoveryReads = 0;
    server.use(
      http.get("/api/match-drafts/:draftId", () => {
        recoveryReads += 1;
        return HttpResponse.error();
      }),
      http.post("/api/matches", async ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        requests.push(await request.json());
        return keys.length === 1
          ? HttpResponse.error()
          : HttpResponse.json({
              createdAt: "2026-01-01T00:00:00Z",
              heldEventId: "held-1",
              matchId: "match-replayed",
              matchNoInEvent: 3,
            });
      }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/confirm-response-lost"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
            <Route path="/matches/:matchId" element={<p>試合詳細</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitForReviewWorkspaceReady();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const continueButton = await screen.findByRole("button", { name: "確定前の確認へ進む" });
      await waitFor(() => expect(continueButton).toBeEnabled());
      await user.click(continueButton);
      await user.click(await screen.findByRole("button", { name: "確定する" }));
      if (attempt === 0)
        await waitFor(() =>
          expect(
            screen.queryByRole("dialog", { name: "この内容で確定しますか？" }),
          ).not.toBeInTheDocument(),
        );
    }
    expect(await screen.findByText("試合詳細")).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toEqual(keys[1]);
    expect(requests[0]).toEqual(requests[1]);
    expect(recoveryReads).toBe(0);
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
          makeMatchDraftReviewResponse(draftId, {
            confirmedMatchId: "match-confirmed-after-conflict",
            status: "confirmed",
          }).draft,
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

    await waitForReviewWorkspaceReady();
    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
    await user.click(await screen.findByRole("button", { name: "確定する" }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "/matches/match-confirmed-after-conflict",
      ),
    );
    expect(postCalled).toBe(true);
    expect(draftDetailRequests).toBe(1);
    expect(await screen.findAllByText(confirmedDraftMessages.confirmConflict)).toHaveLength(1);
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

    await waitForReviewWorkspaceReady();
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

    await waitForReviewWorkspaceReady();
    await user.click(screen.getByRole("button", { name: "確定前の記録を削除" }));
    await user.click(await screen.findByRole("button", { name: "削除する" }));

    const dialog = screen.getByRole("alertdialog", { name: "確定前の記録を削除しますか？" });
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "削除する" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(
      await screen.findByRole("heading", { name: "確定前の記録を削除できませんでした" }),
    ).toBeInTheDocument();
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
      http.get("/api/match-drafts/:draftId/review", async ({ params }) => {
        await responseGate.promise;
        const draftId = String(params["draftId"]);
        return HttpResponse.json(
          makeMatchDraftReviewResponse(draftId, {
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
          }),
        );
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
    expect(screen.getByRole("region", { name: "試合内容" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確定前の確認へ進む" })).not.toBeInTheDocument();

    responseGate.resolve();
    await waitForReviewWorkspaceReady();
    expect(screen.getByRole("button", { name: "確定前の確認へ進む" })).toBeEnabled();
  });

  it("initializes from completed OCR and preserves edits when the same review snapshot changes", async () => {
    setDevUser();
    let response = makeMatchDraftReviewResponse("draft-running-1");
    server.use(http.get("/api/match-drafts/:draftId/review", () => HttpResponse.json(response)));
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/draft-running-1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "読み取り中は編集できません" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "確定前の確認へ進む" })).not.toBeInTheDocument();
    response = makeMatchDraftReviewResponse("draft-running-1", { status: "needs_review" });
    await user.click(screen.getByRole("button", { name: "状態を再確認" }));
    await waitForReviewWorkspaceReady();
    const revenue = screen.getByRole("textbox", { name: "ぽんた 収益（万円）" });
    await user.clear(revenue);
    await user.type(revenue, "-");
    const matchNumber = screen.getByLabelText("試合番号");
    await user.clear(matchNumber);
    await user.type(matchNumber, "9");

    act(() => {
      queryClient.setQueryData(
        matchKeys.draft.review("draft-running-1"),
        makeMatchDraftReviewResponse("draft-running-1", {
          status: "needs_review",
          revenueDraftId: "replacement-revenue",
          matchNoInEvent: 4,
          updatedAt: "2026-02-01T00:00:00.000Z",
        }),
      );
    });

    await waitFor(() => expect(screen.getByLabelText("試合番号")).toHaveValue("9"));
    expect(screen.getByRole("textbox", { name: "ぽんた 収益（万円）" })).toHaveValue("-");
    expect(screen.getByText(/元画像または記録が更新されています/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "元画像を保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "確定前の確認へ進む" })).toBeEnabled();
  });

  it("keeps a running draft read-only after a failed refresh and recovers through the data retry", async () => {
    setDevUser();
    const recoveryResponse = createDeferred();
    let requests = 0;
    server.use(
      http.get("/api/match-drafts/:draftId/review", async () => {
        const attempt = ++requests;
        if (attempt === 2) {
          return HttpResponse.json({ detail: "一時的に状態を取得できません" }, { status: 503 });
        }
        if (attempt === 3) await recoveryResponse.promise;
        return HttpResponse.json(
          makeMatchDraftReviewResponse("draft-retry", {
            matchNoInEvent: attempt === 1 ? 3 : 7,
            status: attempt === 1 ? "ocr_running" : "needs_review",
          }),
        );
      }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/draft-retry"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "状態を再確認" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("画面データを読み込めません");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "読み取り中は編集できません" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "確定前の確認へ進む" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "失敗したデータを再読み込み" }));
    await waitFor(() => expect(requests).toBe(3));
    expect(screen.getByRole("heading", { name: "読み取り中は編集できません" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "確定前の確認へ進む" })).not.toBeInTheDocument();

    await act(async () => recoveryResponse.resolve());
    await waitFor(() => {
      expect(queryClient.getQueryState(matchKeys.draft.review("draft-retry"))).toMatchObject({
        fetchStatus: "idle",
        status: "success",
      });
      expect(screen.getByLabelText("試合番号")).toHaveValue("7");
      expect(
        screen.queryByRole("heading", { name: "画面データを読み込めません" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "確定前の確認へ進む" })).toBeEnabled();
    expect(
      screen.queryByRole("heading", { name: "読み取り中は編集できません" }),
    ).not.toBeInTheDocument();
    expect(requests).toBe(3);
  });

  it("returns to the loading shell when navigating to another review session", async () => {
    setDevUser();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/match-drafts/:draftId/review", async ({ params }) => {
        const draftId = String(params["draftId"]);
        if (draftId === "session-next") {
          await responseGate.promise;
        }
        return HttpResponse.json(
          makeMatchDraftReviewResponse(draftId, {
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
          }),
        );
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

    await waitForReviewWorkspaceReady();
    await user.click(screen.getByRole("link", { name: "別の確認へ" }));

    expect(await screen.findByLabelText("OCR結果を読み込み中")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByRole("button", { name: "確定前の確認へ進む" })).not.toBeInTheDocument();

    responseGate.resolve();
    await waitForReviewWorkspaceReady();
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

  it("announces held event creation and selects the created option", async () => {
    setDevUser();
    const heldEvents = [makeHeldEventResponse()];
    const createdHeldEvent = makeHeldEventResponse({
      heldAt: "2026-01-02T00:00:00.000Z",
      id: "held-created",
    });
    const creationGate = createDeferred();
    server.use(
      http.get("/api/held-events", () => HttpResponse.json({ items: heldEvents })),
      http.post("/api/held-events", async () => {
        await creationGate.promise;
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

    expect(screen.getByRole("button", { name: "開催（必須）を変更" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "確定前の確認へ進む" })).toBeDisabled();
    const revenue = screen.getByRole("textbox", { name: "ぽんた 収益（万円）" });
    expect(revenue).toBeEnabled();
    await user.clear(revenue);
    await user.type(revenue, "42");
    creationGate.resolve();

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
    expect(revenue).toHaveValue("42");
    await user.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    expect(screen.getByRole("button", { name: "確定前の確認へ進む" })).toBeEnabled();
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
