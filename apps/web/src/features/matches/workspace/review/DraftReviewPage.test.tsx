import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { confirmedDraftMessages } from "@/features/matches/confirmedDraftNavigation";
import { DraftReviewPage } from "@/features/matches/workspace/DraftReviewPage";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import {
  createMatchWorkspaceMasterHandoffPayload,
  saveMasterHandoff,
} from "@/shared/workflows/matchWorkspaceMasterHandoff";
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

describe("DraftReviewPage", () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("loads OCR drafts and opens confirmation after validation passes", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /開催履歴/u })).toHaveValue("held-1"),
    );

    await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
    expect(
      await screen.findByRole("heading", { name: "この内容で確定しますか？" }),
    ).toBeInTheDocument();
  });

  it("redirects to the confirmed match when the draft is already confirmed on load", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
    expect(await screen.findAllByText(confirmedDraftMessages.loadRedirect)).not.toHaveLength(0);
  });

  it("checks the latest draft before confirmation and skips POST when already confirmed", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
    expect(await screen.findAllByText(confirmedDraftMessages.confirmConflict)).not.toHaveLength(0);
  });

  it("redirects after a confirm conflict when the draft was confirmed concurrently", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
    expect(await screen.findAllByText(confirmedDraftMessages.confirmConflict)).not.toHaveLength(0);
  });

  it("shows status check failures inside the confirmation dialog", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        confirmedDraftMessages.statusCheckFailed,
      ),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "確定する" })).toBeEnabled(),
    );
  });

  it("keeps the review form unavailable until the draft summary has loaded", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
    expect(screen.queryByRole("button", { name: "確定前の確認へ進む" })).not.toBeInTheDocument();

    responseGate.resolve();
    expect(await screen.findByRole("heading", { name: "OCR結果の確認" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "確定前の確認へ進む" })).toBeEnabled();
  });

  it("returns to the loading shell when navigating to another review session", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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

  it("keeps held event creation collapsed until requested", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("一覧にない開催履歴を追加する")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作成して選択" })).not.toBeVisible();

    await user.click(screen.getByText("一覧にない開催履歴を追加する"));
    expect(screen.getByRole("button", { name: "作成して選択" })).toBeVisible();
  });

  it("announces held event creation and selects the created option", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("一覧にない開催履歴を追加する");
    await user.click(screen.getByText("一覧にない開催履歴を追加する"));
    await user.click(screen.getByRole("button", { name: "作成して選択" }));

    const heldEventSelect = screen.getByLabelText(/開催履歴/u) as HTMLSelectElement;
    await waitFor(() => expect(heldEventSelect).toHaveValue("held-created"));
    expect([...heldEventSelect.options].map((option) => option.value)).toContain("held-created");
    expect(
      screen.getByText(
        `開催履歴（${new Date(createdHeldEvent.heldAt).toLocaleString()}）を作成して選択しました。`,
      ),
    ).toBeInTheDocument();
  });

  it("renders the development sample drafts without OCR worker data", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("サンプルの読み取り結果で表示中")).toBeInTheDocument();
    const matchSetupHeading = screen.getByRole("heading", { name: "保存先と試合条件" });
    const playerResultsHeading = screen.getByRole("heading", {
      name: "4人分の結果を確認・修正",
    });
    expect(
      matchSetupHeading.compareDocumentPosition(playerResultsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText(/保存先の開催履歴と作品情報を先に選びます/u)).toBeInTheDocument();
    expect(await screen.findByDisplayValue("あかねまみ")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("15420")).toBeInTheDocument();
    expect(screen.queryByText("OCR読み取り状況を確認")).not.toBeInTheDocument();
    expect(screen.queryByText(/緑=高信頼OCR/u)).not.toBeInTheDocument();
    expect(screen.getByText(/Enterキーと矢印キーで移動できます/u)).toBeInTheDocument();
  });

  it("allows clearing and retyping numeric result cells without prefixing zero", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("サンプルの読み取り結果で表示中");
    const rankInput = screen.getByLabelText("ぽんた 順位");

    await user.clear(rankInput);
    expect(rankInput).toHaveValue("");

    await user.type(rankInput, "03");
    expect(rankInput).toHaveValue("3");
    expect(screen.getByText("手修正")).toBeInTheDocument();
  });

  it("restores form values after returning from master management with handoffId", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    const handoffId = saveMasterHandoff(
      createMatchWorkspaceMasterHandoffPayload({
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
