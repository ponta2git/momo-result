import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MatchCreatePage } from "@/features/matches/MatchCreatePage";
import type { AuthMeResponse } from "@/shared/api/auth";
import { authMeQueryKeyFor } from "@/shared/auth/authQueries";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import {
  createMatchWorkspaceMasterHandoffPayload,
  saveMasterHandoff,
} from "@/shared/workflows/matchWorkspaceMasterHandoff";
import { setDevUser, testDevUserAccountId } from "@/test/auth";
import { makeMatchWorkspaceMasterHandoffValues } from "@/test/factories/draftReview";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

let user: ReturnType<typeof userEvent.setup>;

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

async function waitForMatchCreateReady() {
  expect(await screen.findByRole("button", { name: "開催（必須）を変更" })).toBeEnabled();
  expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
}

describe("MatchCreatePage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
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

    await waitForMatchCreateReady();
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

  it("does not treat the initial held-event default as a user edit", async () => {
    window.sessionStorage.clear();
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/new"]}>
          <Routes>
            <Route path="/matches/new" element={<MatchCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitForMatchCreateReady();
    await user.click(screen.getByRole("button", { name: "開催（必須）を変更" }));
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("value", "held-1");
    expect(window.sessionStorage.length).toBe(0);
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

    await waitForMatchCreateReady();
    await waitFor(() => {
      expect(screen.getByText(/確定済み3試合・未確定下書き2件/u)).toBeInTheDocument();
      expect(screen.getByLabelText("試合番号")).toHaveValue("8");
    });
  });

  it("preserves user input when only preferred-event and return context change", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/new"]}>
          <Link to="/matches/new?heldEventId=held-requested&returnTo=%2Fmatches">
            作成コンテキストを更新
          </Link>
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

    await waitForMatchCreateReady();
    const matchNumber = screen.getByLabelText("試合番号");
    await user.clear(matchNumber);
    await user.type(matchNumber, "9");

    await user.click(screen.getByRole("link", { name: "作成コンテキストを更新" }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "heldEventId=held-requested",
      ),
    );
    expect(screen.getByLabelText("試合番号")).toHaveValue("9");
  });

  it("keys local form state by authenticated principal identity", async () => {
    setDevUser();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/new"]}>
          <Routes>
            <Route path="/matches/new" element={<MatchCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitForMatchCreateReady();
    await waitFor(() =>
      expect(queryClient.getQueryData(authMeQueryKeyFor(testDevUserAccountId))).toMatchObject({
        accountId: testDevUserAccountId,
      }),
    );
    const initialMatchNumber = (screen.getByLabelText("試合番号") as HTMLInputElement).value;
    const matchNumber = screen.getByLabelText("試合番号");
    await user.clear(matchNumber);
    await user.type(matchNumber, "9");

    await act(async () => {
      queryClient.setQueryData<AuthMeResponse>(
        authMeQueryKeyFor(testDevUserAccountId),
        (current) => (current ? { ...current, displayName: "更新された表示名" } : current),
      );
    });
    expect(screen.getByLabelText("試合番号")).toHaveValue("9");

    await act(async () => {
      queryClient.setQueryData<AuthMeResponse>(
        authMeQueryKeyFor(testDevUserAccountId),
        (current) => (current ? { ...current, accountId: "account_eu" } : current),
      );
    });

    await waitFor(() => expect(screen.getByLabelText("試合番号")).toHaveValue(initialMatchNumber));
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

    await waitForMatchCreateReady();
    await waitFor(() => expect(requestedDraftId).toBe("draft-trimmed"));
  });

  it("initializes from a draft summary after its initial request is retried", async () => {
    setDevUser();
    let failDraftDetail = true;
    server.use(
      http.get("/api/match-drafts/draft-retry", () =>
        failDraftDetail
          ? HttpResponse.json({ detail: "draft unavailable" }, { status: 500 })
          : HttpResponse.json({
              createdAt: "2026-01-01T00:00:00.000Z",
              gameTitleId: "gt_momotetsu_2",
              heldEventId: "held-1",
              mapMasterId: "map_east",
              matchDraftId: "draft-retry",
              matchNoInEvent: 7,
              ownerMemberId: "member_ponta",
              playedAt: "2026-01-01T00:00:00.000Z",
              seasonMasterId: "season_current",
              status: "needs_review",
              updatedAt: "2026-01-01T00:00:00.000Z",
            }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/new?matchDraftId=draft-retry"]}>
          <Routes>
            <Route path="/matches/new" element={<MatchCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("画面データを読み込めません")).toBeInTheDocument();
    expect(screen.queryByLabelText("試合番号")).not.toBeInTheDocument();

    failDraftDetail = false;
    await user.click(screen.getByRole("button", { name: "失敗したデータを再読み込み" }));

    await waitFor(() => expect(screen.getByLabelText("試合番号")).toHaveValue("7"));
    expect(screen.queryByText("画面データを読み込めません")).not.toBeInTheDocument();
  });

  it("does not restore manual creation values from a foreign handoff session", async () => {
    setDevUser();
    const handoffId = saveMasterHandoff(
      createMatchWorkspaceMasterHandoffPayload({
        accountId: testDevUserAccountId,
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

    // Wait for the lazy toast renderer before starting the notification assertion timeout.
    await act(() => vi.dynamicImportSettled());

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

    await waitForMatchCreateReady();
    const eventDisclosure = screen.getByText("一覧にない開催を追加する");
    await user.click(eventDisclosure);
    await user.click(screen.getByRole("button", { name: "作成して選択" }));

    const failure = await screen.findByRole("heading", { name: "開催を追加できませんでした" });
    const notice = failure.closest("section");
    expect(notice).toHaveTextContent("試合条件も変更していません");
    expect(notice).toHaveTextContent("もう一度作成してください");
    expect(screen.getByRole("button", { name: "作成して選択" })).toBeEnabled();
  });
});
