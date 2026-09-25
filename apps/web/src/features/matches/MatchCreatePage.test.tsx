import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import {
  createMemoryRouter,
  Link,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useLocation,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MastersPage } from "@/features/masters/MastersPage";
import { MatchCreatePage } from "@/features/matches/MatchCreatePage";
import type { AuthMeResponse } from "@/shared/api/auth";
import { authMeQueryKeyFor } from "@/shared/auth/authQueries";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import {
  createMatchWorkspaceMasterHandoffPayload,
  saveMasterHandoff,
} from "@/shared/workflows/matchWorkspaceMasterHandoff";
import { setDevUser, testDevUserAccountId } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeMatchWorkspaceMasterHandoffValues } from "@/test/factories/draftReview";
import { makeMatchDraftReviewResponse } from "@/test/factories/matchDraftReview";
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
}

describe("MatchCreatePage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("initializes from the latest picker page without fetching a second directory", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 10_000 } });
    const requests: URLSearchParams[] = [];
    server.use(
      http.get("/api/held-events", ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          items: [
            {
              id: "held-latest",
              heldAt: "2026-06-01T00:00:00Z",
              matchCount: 8,
              draftCount: 0,
              nextMatchNo: 9,
            },
            {
              id: "held-older",
              heldAt: "2026-01-01T00:00:00Z",
              matchCount: 2,
              draftCount: 0,
              nextMatchNo: 3,
            },
          ],
        });
      }),
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
    await waitFor(() => expect(screen.getByLabelText("試合番号")).toHaveValue("9"));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.get("page")).toBe("1");
    expect(requests[0]?.get("pageSize")).toBe("20");
    expect(requests[0]?.has("limit")).toBe(false);
  });

  it("preserves notes and unfinished numbers through master handoff and still protects unsaved input", async () => {
    setDevUser();
    const router = createMemoryRouter(
      [
        { path: "/matches/new", element: <MatchCreatePage /> },
        { path: "/admin/masters", element: <MastersPage /> },
        { path: "/outside", element: <p>別の作業</p> },
      ],
      { initialEntries: ["/matches/new"] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await waitForMatchCreateReady();
    await user.type(
      screen.getByRole("textbox", { name: "試合メモ（任意）" }),
      "カード交換を後で確認",
    );
    const revenue = screen.getByRole("textbox", { name: "ぽんた 収益（万円）" });
    await user.clear(revenue);
    await user.type(revenue, "-");
    await user.click(screen.getByRole("button", { name: "設定管理へ" }));
    const returnAction = await screen.findByRole("button", { name: "元の入力画面へ戻る" });
    expect(router.state.location.pathname).toBe("/admin/masters");
    const returnParams = new URLSearchParams(router.state.location.search);
    expect(returnParams.get("returnTo")).toBe("/matches/new");
    expect(returnParams.get("handoffId")).toBeTruthy();
    await user.click(returnAction);
    await waitForMatchCreateReady();
    expect(screen.getByRole("textbox", { name: "試合メモ（任意）" })).toHaveValue(
      "カード交換を後で確認",
    );
    expect(screen.getByRole("textbox", { name: "ぽんた 収益（万円）" })).toHaveValue("-");
    expect(screen.queryByRole("button", { name: "一時保存を復元" })).not.toBeInTheDocument();
    act(() => {
      void router.navigate("/outside");
    });
    expect(
      await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(router.state.location.pathname).toBe("/matches/new");
  });

  it("keeps the master handoff pending until the destination loader finishes", async () => {
    setDevUser();
    const destinationGate = createDeferred();
    let destinationStarted = false;
    const router = createMemoryRouter(
      [
        { path: "/matches/new", element: <MatchCreatePage /> },
        {
          path: "/admin/masters",
          loader: async () => {
            destinationStarted = true;
            await destinationGate.promise;
            return null;
          },
          element: <p>masters</p>,
        },
      ],
      { initialEntries: ["/matches/new"] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await waitForMatchCreateReady();
    await user.click(screen.getByRole("button", { name: "設定管理へ" }));
    await waitFor(() => expect(destinationStarted).toBe(true));
    expect(screen.getByRole("button", { name: "移動中…" })).toBeDisabled();
    destinationGate.resolve();
    expect(await screen.findByText("masters")).toBeInTheDocument();
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
      http.get("/api/held-events/:heldEventId/summary", ({ params }) =>
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
    const router = createMemoryRouter(
      [
        {
          path: "/matches/new",
          element: (
            <>
              <Link to="/matches/new?heldEventId=held-requested&returnTo=%2Fmatches">
                作成コンテキストを更新
              </Link>
              <Link to="/matches/new?matchDraftId=another-draft">別の下書きを入力</Link>
              <LocationProbe />
              <MatchCreatePage />
            </>
          ),
        },
        { path: "/matches", element: <p>試合一覧</p> },
      ],
      { initialEntries: ["/matches/new"] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
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
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "入力をやめる" }));
    expect(
      await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await user.click(screen.getByRole("link", { name: "別の下書きを入力" }));
    expect(
      await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "破棄して移動" }));
    await waitFor(() => expect(screen.getByLabelText("試合番号")).toHaveValue("3"));
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
      http.get("/api/match-drafts/:draftId/review", ({ params }) => {
        requestedDraftId = String(params["draftId"]);
        return HttpResponse.json(makeMatchDraftReviewResponse(requestedDraftId));
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
      http.get("/api/match-drafts/draft-retry/review", () =>
        failDraftDetail
          ? HttpResponse.json({ detail: "draft unavailable" }, { status: 500 })
          : HttpResponse.json(makeMatchDraftReviewResponse("draft-retry", { matchNoInEvent: 7 })),
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
