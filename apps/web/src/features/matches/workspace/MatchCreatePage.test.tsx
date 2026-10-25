import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

import { MatchDetailPage } from "@/features/matches/detail/MatchDetailPage";
import { MatchCreatePage } from "@/features/matches/workspace/MatchCreatePage";
import { matchWorkspaceSessionDraftKey } from "@/features/matches/workspace/matchWorkspaceSessionDraft";
import type { AuthMeResponse } from "@/shared/api/auth";
import type { ConfirmMatchRequest } from "@/shared/api/matches";
import { authMeQueryKeyFor } from "@/shared/auth/authQueries";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { setDevUser, testDevUserAccountId } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeFourPlayerResults, makeMatchDetail } from "@/test/factories";
import { makeMatchDraftReviewResponse } from "@/test/factories/matchDraftReview";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

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

  // The connected form, confirmation, and detail flow shares one total budget under coverage.
  it(
    "confirms manual input into the returned match and reads its result and note",
    { timeout: 15_000 },
    async () => {
      setDevUser();
      const noteBody = "カード交換を次戦に生かす";
      const expectedRequest = {
        achievements: [],
        heldEventId: "held-1",
        matchNoInEvent: 7,
        gameTitleId: "gt_momotetsu_2",
        seasonMasterId: "season_current",
        mapMasterId: "map_east",
        ownerMemberId: "member_ponta",
        playedAt: "2026-01-01T00:00:00.000Z",
        draftIds: {},
        players: makeFourPlayerResults([
          { totalAssetsManYen: 1234, revenueManYen: -42 },
          { totalAssetsManYen: 0, revenueManYen: 0 },
          { totalAssetsManYen: 0, revenueManYen: 0 },
          { totalAssetsManYen: 0, revenueManYen: 0 },
        ]),
        noteBody,
      } satisfies ConfirmMatchRequest;
      const savedMatch = makeMatchDetail({
        matchId: "match-manual-created",
        matchNoInEvent: 7,
        heldAt: expectedRequest.playedAt,
        playedAt: expectedRequest.playedAt,
        players: expectedRequest.players,
        note: { body: noteBody, version: "1" },
      });
      const requests: unknown[] = [];
      const operationKeys: Array<string | null> = [];
      const reads: string[] = [];
      server.use(
        http.post("/api/matches", async ({ request }) => {
          requests.push(await request.json());
          operationKeys.push(request.headers.get("Idempotency-Key"));
          return HttpResponse.json({
            createdAt: savedMatch.createdAt,
            heldEventId: savedMatch.heldEventId,
            matchId: savedMatch.matchId,
            matchNoInEvent: savedMatch.matchNoInEvent,
          });
        }),
        http.get("/api/matches/:matchId", ({ params }) => {
          reads.push(String(params["matchId"]));
          return HttpResponse.json(savedMatch);
        }),
      );
      const router = createMemoryRouter(
        [
          { path: "/matches/new", element: <MatchCreatePage /> },
          { path: "/matches/:matchId", element: <MatchDetailPage /> },
        ],
        { initialEntries: ["/matches/new?heldEventId=held-1"] },
      );
      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
      await waitForMatchCreateReady();
      await selectOption(
        user,
        screen.getByRole("combobox", { name: "作品（必須）" }),
        "gt_momotetsu_2",
      );
      await selectOption(
        user,
        screen.getByRole("combobox", { name: "シーズン（必須）" }),
        "season_current",
      );
      await selectOption(
        user,
        screen.getByRole("combobox", { name: "マップ（必須）" }),
        "map_east",
      );
      for (const [label, value] of [
        ["試合番号", "7"],
        ["ぽんた 総資産（万円）", "1234"],
        ["ぽんた 収益（万円）", "-42"],
      ] as const) {
        const input = screen.getByRole("textbox", { name: label });
        await user.clear(input);
        await user.type(input, value);
      }
      await user.type(screen.getByRole("textbox", { name: "試合メモ（任意）" }), noteBody);
      await user.click(screen.getByRole("button", { name: "確定前の確認へ進む" }));
      const confirmation = await screen.findByRole("dialog", { name: "この内容で確定しますか？" });
      expect(within(confirmation).getByRole("cell", { name: "1,234" })).toBeVisible();
      await user.click(within(confirmation).getByRole("button", { name: "確定する" }));

      expect(await screen.findByRole("heading", { name: "第7試合の結果" })).toBeVisible();
      expect(router.state.location.pathname).toBe("/matches/match-manual-created");
      expect(requests).toEqual([expectedRequest]);
      expect(
        window.sessionStorage.getItem(
          matchWorkspaceSessionDraftKey({
            accountId: testDevUserAccountId,
            mode: "create",
            workspaceKey: "create",
          }),
        ),
      ).toBeNull();
      expect(operationKeys[0]).toBeTruthy();
      expect(new Set(reads)).toEqual(new Set(["match-manual-created"]));
      expect(screen.getByText("カード交換を次戦に生かす")).toBeVisible();
      const results = screen.getByRole("list", { name: "試合の順位と成績" });
      const ponta = within(results)
        .getAllByRole("listitem")
        .find((row) => within(row).queryByRole("heading", { name: "ぽんた" }));
      expect(ponta).toHaveTextContent("1234万円");
      expect(ponta).toHaveTextContent("-42万円");
    },
  );

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

  it("restores input on native Back and saves it again before native Forward without discarding", async () => {
    setDevUser();
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({
          accountId: testDevUserAccountId,
          csrfToken: "dev",
          displayName: "Operator",
          memberId: "member_ponta",
          role: "operator",
        }),
      ),
    );
    const router = createMemoryRouter(
      [
        { path: "/matches/new", element: <MatchCreatePage /> },
        { path: "/admin/masters", element: <p>設定管理</p> },
      ],
      { initialEntries: ["/matches/new"] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await waitForMatchCreateReady();
    const expectedInputs = [
      ["ぽんた 総資産（万円）", "1234"],
      ["あかねまみ 総資産（万円）", "2345"],
      ["おーたか 総資産（万円）", "3456"],
      ["いーゆー 総資産（万円）", "4567"],
      ["ぽんた 収益（万円）", "-"],
    ] as const;
    for (const [name, value] of expectedInputs) {
      const input = screen.getByLabelText(name);
      await user.clear(input);
      await user.paste(value);
    }
    await user.click(screen.getByRole("textbox", { name: "試合メモ（任意）" }));
    await user.paste("カード交換を後で確認");
    const createPage = screen.getByRole("region", { name: "試合内容" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "設定管理へ" }));
    });
    expect(createPage).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/admin/masters");
    expect(router.state.location.search).toBe("");
    const storageKey = matchWorkspaceSessionDraftKey({
      accountId: testDevUserAccountId,
      mode: "create",
      workspaceKey: "create",
    });
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null")).toMatchObject({
      resumeAutomatically: true,
    });
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "試合メモ（任意）" })).toHaveValue(
        "カード交換を後で確認",
      ),
    );
    for (const [name, value] of expectedInputs) {
      expect(screen.getByLabelText(name)).toHaveValue(value);
    }
    expect(screen.queryByRole("button", { name: "一時保存を復元" })).not.toBeInTheDocument();
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null")).toMatchObject({
      resumeAutomatically: false,
    });
    await act(async () => {
      await router.navigate(1);
    });
    expect(await screen.findByText("設定管理")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null")).toMatchObject({
      resumeAutomatically: false,
      values: { noteBody: "カード交換を後で確認" },
    });
    await act(async () => {
      await router.navigate(-1);
    });
    await user.click(await screen.findByRole("button", { name: "一時保存を復元" }));
    expect(screen.getByRole("textbox", { name: "試合メモ（任意）" })).toHaveValue(
      "カード交換を後で確認",
    );
    for (const [name, value] of expectedInputs) {
      expect(screen.getByLabelText(name)).toHaveValue(value);
    }
  });

  it("does not restore saved input when the initial workspace data has changed", async () => {
    setDevUser();
    const renderWorkspace = () =>
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/matches/new"]}>
            <Routes>
              <Route path="/matches/new" element={<MatchCreatePage />} />
              <Route path="/admin/masters" element={<p>設定管理</p>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    const firstView = renderWorkspace();
    await waitForMatchCreateReady();
    await user.type(screen.getByRole("textbox", { name: "試合メモ（任意）" }), "以前の開催の入力");
    await user.click(screen.getByRole("button", { name: "設定管理へ" }));
    expect(await screen.findByText("設定管理")).toBeInTheDocument();
    const storageKey = matchWorkspaceSessionDraftKey({
      accountId: testDevUserAccountId,
      mode: "create",
      workspaceKey: "create",
    });
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null")).toMatchObject({
      resumeAutomatically: true,
    });
    firstView.unmount();
    queryClient = createTestQueryClient();
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({
          items: [
            {
              id: "held-updated",
              heldAt: "2026-03-01T00:00:00.000Z",
              matchCount: 8,
              draftCount: 0,
              nextMatchNo: 9,
            },
          ],
        }),
      ),
    );
    renderWorkspace();
    await waitForMatchCreateReady();
    await waitFor(() => expect(screen.getByLabelText("試合番号")).toHaveValue("9"));
    expect(screen.getByRole("textbox", { name: "試合メモ（任意）" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "一時保存を復元" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("keeps input and navigation protection when temporary storage is unavailable", async () => {
    setDevUser();
    const router = createMemoryRouter(
      [
        { path: "/matches/new", element: <MatchCreatePage /> },
        { path: "/admin/masters", element: <p>設定管理</p> },
        { path: "/outside", element: <p>別の作業</p> },
      ],
      { initialEntries: ["/matches/new"] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <ToastHost />
      </QueryClientProvider>,
    );
    await waitForMatchCreateReady();
    await user.type(screen.getByRole("textbox", { name: "試合メモ（任意）" }), "保持する入力");
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    });
    try {
      await user.click(screen.getByRole("button", { name: "設定管理へ" }));
      expect(
        await screen.findByText(
          "入力内容を一時保存できなかったため、設定管理へ移動しませんでした。もう一度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/matches/new");
      expect(screen.getByRole("textbox", { name: "試合メモ（任意）" })).toHaveValue("保持する入力");
      act(() => {
        void router.navigate("/outside");
      });
      expect(
        await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" }),
      ).toBeVisible();
    } finally {
      storage.mockRestore();
    }
  });

  it("keeps settings navigation pending until the destination loader finishes", async () => {
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

  it("preserves user input when only the preferred event changes", async () => {
    setDevUser();
    const router = createMemoryRouter(
      [
        {
          path: "/matches/new",
          element: (
            <>
              <Link to="/matches/new?heldEventId=held-requested">作成コンテキストを更新</Link>
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

    await user.click(screen.getByRole("link", { name: "別の下書きを入力" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("試合番号")).toHaveValue("3"));
    expect(
      JSON.parse(
        window.sessionStorage.getItem(
          matchWorkspaceSessionDraftKey({
            accountId: testDevUserAccountId,
            mode: "create",
            workspaceKey: "create",
          }),
        ) ?? "null",
      ),
    ).toMatchObject({ resumeAutomatically: false, values: { matchNoInEvent: 9 } });
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
    const changeRole = async (role: AuthMeResponse["role"]) => {
      await act(async () => {
        queryClient.setQueryData<AuthMeResponse>(
          authMeQueryKeyFor(testDevUserAccountId),
          (current) => (current ? { ...current, role } : current),
        );
      });
    };
    for (const role of ["operator", "user", "admin"] as const) {
      await changeRole(role);
      expect(screen.getByLabelText("試合番号")).toHaveValue("9");
      if (role === "user") {
        expect(screen.queryByRole("button", { name: "設定管理へ" })).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole("button", { name: "設定管理へ" })).toBeEnabled();
      }
    }

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
