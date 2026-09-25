import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useLocation,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HeldEventDetailPage } from "@/features/heldEvents/HeldEventDetailPage";
import { HeldEventsPage } from "@/features/heldEvents/HeldEventsPage";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";
import { makeHeldEventDetailResponse, makeHeldEventResponse } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(path = "/held-events", realDetails = false) {
  setDevUser();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route element={<HeldEventsPage />} path="/held-events" />
          <Route
            element={realDetails ? <HeldEventDetailPage /> : <p>held event detail</p>}
            path="/held-events/:heldEventId"
          />
          <Route element={<p>matches</p>} path="/matches" />
          <Route element={<p>ocr capture</p>} path="/ocr/new" />
          <Route element={<p>exports</p>} path="/exports" />
        </Routes>
        <ToastHost />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let matchMedia: MatchMediaController | undefined;
let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;

describe("HeldEventsPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  afterEach(() => {
    matchMedia?.restore();
    matchMedia = undefined;
  });

  it("renders held-event status and related links", async () => {
    matchMedia = installMatchMediaController(true);
    renderPage();

    expect(await screen.findByRole("region", { name: "開催履歴" })).toBeInTheDocument();
    expect(await screen.findByText("最新")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "開催履歴" })).toBeInTheDocument();
    expect(screen.getByText("確定済み")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "結果" })).toBeInTheDocument();
    expect(screen.getByText("0件")).toBeInTheDocument();
    expect(screen.queryByText("held-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "開催を作成" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /の開催詳細$/u })).toHaveAttribute(
      "href",
      "/held-events/held-1?returnTo=%2Fheld-events",
    );
    expect(
      screen.queryByRole("link", { name: /試合検索で見る|の試合を検索$/u }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /をCSV出力$/u })).toHaveAttribute(
      "href",
      "/exports?heldEventId=held-1&format=csv&returnTo=%2Fheld-events",
    );
  });

  it("shows every series and season in its held-event row, including a partly configured draft", async () => {
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({
          items: [
            makeHeldEventResponse({
              id: "held-scopes",
              scopes: [
                {
                  gameTitleId: "world",
                  gameTitleName: "桃鉄ワールド",
                  seasonMasterId: "spring",
                  seasonName: "春シーズン",
                },
                {
                  gameTitleId: "two",
                  gameTitleName: "桃鉄2",
                  seasonMasterId: "summer",
                  seasonName: "夏シーズン",
                },
                { gameTitleId: "two", gameTitleName: "桃鉄2" },
              ],
            }),
            makeHeldEventResponse({ id: "held-empty", scopes: [] }),
          ],
        }),
      ),
    );
    renderPage();
    const scopes = await screen.findByRole("list", { name: "開催のシリーズ・シーズン" });
    expect(
      within(scopes)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["桃鉄ワールド・春シーズン", "桃鉄2・夏シーズン", "桃鉄2・シーズン未設定"]);
    expect(screen.getAllByRole("list", { name: "開催のシリーズ・シーズン" })).toHaveLength(1);
  });

  it("starts OCR from only the latest held event and preserves the list location", async () => {
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({
          items: [
            makeHeldEventResponse({
              heldAt: "2026-02-02T03:04:00.000Z",
              id: "held-newest",
            }),
            makeHeldEventResponse({
              heldAt: "2026-01-02T03:04:00.000Z",
              id: "held-older",
            }),
          ],
        }),
      ),
    );

    renderPage("/held-events?pageSize=25");

    const ocrLink = await screen.findByRole("link", { name: /の開催にOCR取り込み$/u });
    expect(ocrLink).toHaveAttribute(
      "href",
      "/ocr/new?heldEventId=held-newest&returnTo=%2Fheld-events%3FpageSize%3D25",
    );

    await user.click(ocrLink);

    expect(screen.getByLabelText("current location")).toHaveTextContent(
      "/ocr/new?heldEventId=held-newest&returnTo=%2Fheld-events%3FpageSize%3D25",
    );
    expect(screen.getByText("ocr capture")).toBeInTheDocument();
  });

  it("hides pagination controls when the list is empty", async () => {
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({
          items: [],
          pagination: {
            hasNextPage: false,
            hasPreviousPage: false,
            page: 1,
            pageSize: 10,
            totalItems: 0,
            totalPages: 0,
          },
          totalMatchCount: 0,
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText("開催履歴はまだありません")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "開催を作成" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最初の開催を作成" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /の開催にOCR取り込み$/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "ページネーション" })).not.toBeInTheDocument();
  });

  it("retries a failed held-event list without showing an empty state", async () => {
    let attempts = 0;
    server.use(
      http.get("/api/held-events", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [makeHeldEventResponse()] });
      }),
    );

    renderPage();

    expect(await screen.findByText("開催履歴を読み込めません")).toBeInTheDocument();
    expect(screen.queryByText("開催履歴はまだありません")).not.toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "開催履歴を再読み込み" });
    await user.click(retryButton);

    expect(await screen.findByRole("link", { name: /の開催詳細$/u })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("keeps the current ledger usable when a same-scope refresh fails", async () => {
    let attempts = 0;
    server.use(
      http.get("/api/held-events", () => {
        attempts += 1;
        return attempts === 2
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [makeHeldEventResponse()] });
      }),
    );

    renderPage();

    const detailLink = await screen.findByRole("link", { name: /の開催詳細$/u });
    await user.click(screen.getByRole("button", { name: "更新" }));

    const surface = screen.getByRole("region", { name: "開催履歴" });
    expect(await within(surface).findByText("開催履歴を更新できませんでした")).toBeInTheDocument();
    expect(detailLink).toBeInTheDocument();
    expect(detailLink).toHaveAttribute("href", "/held-events/held-1?returnTo=%2Fheld-events");
    expect(screen.getByRole("button", { name: "開催を作成" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /を削除$/u })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "開催履歴を再取得" }));

    await waitFor(() =>
      expect(screen.queryByText("開催履歴を更新できませんでした")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /の開催詳細$/u })).toBeInTheDocument();
    expect(attempts).toBe(3);
  });

  it("does not present prior-page rows as a failed newly selected page", async () => {
    let pageTwoAttempts = 0;
    server.use(
      http.get("/api/held-events", ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
        if (page === 2) {
          pageTwoAttempts += 1;
          if (pageTwoAttempts === 1) {
            return HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 });
          }
        }
        return HttpResponse.json({
          items: [
            makeHeldEventResponse({
              heldAt: page === 1 ? "2026-01-02T03:04:00.000Z" : "2025-12-02T03:04:00.000Z",
              id: page === 1 ? "held-page-1" : "held-page-2",
            }),
          ],
          pagination: {
            hasNextPage: page === 1,
            hasPreviousPage: page === 2,
            page,
            pageSize: 10,
            totalItems: 11,
            totalPages: 2,
          },
          totalMatchCount: 0,
        });
      }),
    );

    renderPage();

    expect(await screen.findByRole("link", { name: /の開催詳細$/u })).toHaveAttribute(
      "href",
      "/held-events/held-page-1?returnTo=%2Fheld-events",
    );
    await user.click(screen.getByRole("button", { name: "次のページへ" }));

    expect(await screen.findByText("開催履歴を読み込めません")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /の開催詳細$/u })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "開催履歴を再読み込み" }));

    expect(await screen.findByRole("link", { name: /の開催詳細$/u })).toHaveAttribute(
      "href",
      "/held-events/held-page-2?returnTo=%2Fheld-events%3Fpage%3D2",
    );
    expect(pageTwoAttempts).toBe(2);
  });

  it("corrects an out-of-range page before showing an empty-list state", async () => {
    const heldEvents = [makeHeldEventResponse()];
    server.use(
      http.get("/api/held-events", ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get("page") ?? "1");
        const pageSize = Number(url.searchParams.get("pageSize") ?? "10");
        const offset = (page - 1) * pageSize;
        return HttpResponse.json({
          items: heldEvents.slice(offset, offset + pageSize),
          pagination: {
            hasNextPage: false,
            hasPreviousPage: page > 1,
            page,
            pageSize,
            totalItems: heldEvents.length,
            totalPages: 1,
          },
          totalMatchCount: 0,
        });
      }),
    );

    renderPage("/held-events?page=99");

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("/held-events"),
    );
    expect(await screen.findByRole("link", { name: /の開催詳細$/u })).toBeInTheDocument();
    expect(screen.queryByText("開催履歴はまだありません")).not.toBeInTheDocument();
  });

  it("uses default pagination for partial numeric query values", async () => {
    let captured: URL | undefined;
    server.use(
      http.get("/api/held-events", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("pageSize") !== "1") {
          captured = url;
        }
        return HttpResponse.json({
          items: [makeHeldEventResponse()],
          pagination: {
            hasNextPage: false,
            hasPreviousPage: false,
            page: 1,
            pageSize: 10,
            totalItems: 1,
            totalPages: 1,
          },
          totalMatchCount: 0,
        });
      }),
    );

    renderPage("/held-events?page=2abc&pageSize=50x");

    expect(await screen.findByRole("link", { name: /の開催詳細$/u })).toBeInTheDocument();
    expect(captured?.searchParams.get("page")).toBe("1");
    expect(captured?.searchParams.get("pageSize")).toBe("10");
  });

  it("keeps the current list and pager stable while the next page loads", async () => {
    const secondPageGate = createDeferred();
    const firstPageEvent = makeHeldEventResponse({
      heldAt: "2026-01-02T03:04:00.000Z",
      id: "held-page-1",
    });
    const secondPageEvent = makeHeldEventResponse({
      heldAt: "2025-12-02T03:04:00.000Z",
      id: "held-page-2",
    });
    server.use(
      http.get("/api/held-events", async ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
        if (page === 2) {
          await secondPageGate.promise;
        }
        return HttpResponse.json({
          items: [page === 2 ? secondPageEvent : firstPageEvent],
          pagination: {
            hasNextPage: page === 1,
            hasPreviousPage: page === 2,
            page,
            pageSize: 10,
            totalItems: 11,
            totalPages: 2,
          },
          totalMatchCount: 0,
        });
      }),
    );

    renderPage();

    const firstPageLink = await screen.findByRole("link", { name: /の開催詳細$/u });
    expect(firstPageLink).toHaveAttribute(
      "href",
      "/held-events/held-page-1?returnTo=%2Fheld-events",
    );
    await user.click(screen.getByRole("button", { name: "次のページへ" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "更新中…" })).toBeDisabled());
    const ledger = screen.getByRole("region", { name: "開催履歴" });
    expect(within(ledger).queryByRole("status")).not.toBeInTheDocument();
    expect(within(ledger).queryByLabelText("開催履歴を読み込み中")).not.toBeInTheDocument();
    const disabledDetail = within(ledger).getByRole("link", { name: /の開催詳細$/u });
    expect(disabledDetail).toHaveAttribute("aria-disabled", "true");
    expect(disabledDetail).not.toHaveAttribute("href");
    for (const link of within(ledger).getAllByRole("link")) {
      expect(link).toHaveAttribute("aria-disabled", "true");
      expect(link).not.toHaveAttribute("href");
    }
    expect(within(ledger).getByRole("button", { name: /を削除$/u })).toBeDisabled();
    await user.click(disabledDetail);
    expect(screen.getByLabelText("current location")).toHaveTextContent("/held-events?page=2");
    expect(screen.getByText("最新")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "ページネーション" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次のページへ" })).toBeDisabled();

    secondPageGate.resolve();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /の開催詳細$/u })).toHaveAttribute(
        "href",
        "/held-events/held-page-2?returnTo=%2Fheld-events%3Fpage%3D2",
      ),
    );
    expect(screen.getByRole("region", { name: "開催履歴" })).not.toHaveAttribute("aria-busy");
    expect(within(ledger).queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("最新")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /の開催にOCR取り込み$/u })).not.toBeInTheDocument();
    expect(screen.getByText("2／2")).toBeInTheDocument();
  });

  it("creates a held event in a dialog and continues to its detail page", async () => {
    const requests: Array<{ body: unknown; idempotencyKey: string | null }> = [];
    const heldEvents = [makeHeldEventResponse()];
    const created = makeHeldEventResponse({
      heldAt: "2026-01-02T03:04:00.000Z",
      id: "held-created",
    });
    server.use(
      http.get("/api/held-events", () => HttpResponse.json({ items: heldEvents })),
      http.post("/api/held-events", async ({ request }) => {
        requests.push({
          body: await request.json(),
          idempotencyKey: request.headers.get("Idempotency-Key"),
        });
        heldEvents.unshift(created);
        return HttpResponse.json(created);
      }),
      http.get("/api/held-events/held-created", () =>
        HttpResponse.json(
          makeHeldEventDetailResponse({
            ...created,
            navigation: { previous: { id: "held-1", heldAt: "2026-01-01T00:00:00.000Z" } },
          }),
        ),
      ),
    );

    renderPage("/held-events", true);

    expect(await screen.findByRole("link", { name: /の開催詳細$/u })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "開催を作成" }));
    const dialog = screen.getByRole("dialog", { name: "新しい開催を作成" });
    await user.clear(within(dialog).getByLabelText(/開催日時/u));
    await user.type(within(dialog).getByLabelText(/開催日時/u), "2026-01-02T12:04");
    await user.click(within(dialog).getByRole("button", { name: "開催を作成" }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "/held-events/held-created",
      ),
    );
    expect(await screen.findByRole("heading", { name: "2026/01/02 12:04" })).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({ heldAt: "2026-01-02T03:04:00.000Z" });
    expect(requests[0]?.idempotencyKey).toMatch(/\S/u);
    expect(screen.getByRole("link", { name: /前の開催/u })).toHaveAttribute(
      "href",
      "/held-events/held-1?returnTo=%2Fheld-events",
    );
    expect(queryClient.getQueryData(heldEventKeys.detail("held-created"))).toMatchObject({
      kind: "found",
      navigation: { kind: "available", previous: { id: "held-1" } },
    });
  });

  it("opens creation only on request and allows cancelling", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: /の開催詳細$/u })).toBeInTheDocument();
    expect(screen.queryByLabelText("開催日時")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "開催を作成" }));
    expect(screen.getByRole("dialog", { name: "新しい開催を作成" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "新しい開催を作成" })).not.toBeInTheDocument(),
    );
  });

  it.each(["browser back", "wait"])(
    "preserves the originating entry after creation when the user chooses to %s while pending",
    async (completion) => {
      setDevUser();
      const gate = createDeferred();
      const created = makeHeldEventResponse({ id: "created-after-wait" });
      server.use(
        http.get("/api/held-events", () => HttpResponse.json({ items: [makeHeldEventResponse()] })),
        http.post("/api/held-events", async () => {
          await gate.promise;
          return HttpResponse.json(created);
        }),
      );
      const origin = "/held-events?page=2#ledger";
      const router = createMemoryRouter(
        [
          { path: "/held-events", element: <HeldEventsPage /> },
          { path: "/held-events/:heldEventId", element: <p>created detail</p> },
          { path: "/matches", element: <p>matches</p> },
        ],
        { initialEntries: ["/matches", origin] },
      );
      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <ToastHost />
        </QueryClientProvider>,
      );

      await user.click(await screen.findByRole("button", { name: "開催を作成" }));
      const dialog = screen.getByRole("dialog", { name: "新しい開催を作成" });
      await user.click(within(dialog).getByRole("button", { name: "開催を作成" }));
      expect(within(dialog).getByRole("button", { name: "作成中…" })).toBeDisabled();
      if (completion === "browser back") {
        await act(async () => router.navigate(-1));
        expect(router.state.location.pathname).toBe("/held-events");
        expect(screen.getByRole("dialog", { name: "新しい開催を作成" })).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "作成中…" })).toBeDisabled();
        expect(screen.queryByRole("button", { name: "破棄して移動" })).not.toBeInTheDocument();
      }
      await act(async () => gate.resolve());
      await waitFor(() =>
        expect(queryClient.getQueryData(heldEventKeys.summary(created.id))).toEqual(created),
      );

      await screen.findByText("created detail");
      expect(new URLSearchParams(router.state.location.search).get("returnTo")).toBe(origin);
      await act(async () => router.navigate(-1));
      expect(
        `${router.state.location.pathname}${router.state.location.search}${router.state.location.hash}`,
      ).toBe(origin);
    },
  );

  it("keeps a dismissed creation failure in the held-event owner surface", async () => {
    server.use(
      http.post("/api/held-events", () =>
        HttpResponse.json(
          {
            code: "INTERNAL_ERROR",
            detail: "開催日時を保存できませんでした。",
            status: 500,
            title: "Internal Server Error",
            type: "about:blank",
          },
          { status: 500 },
        ),
      ),
    );
    renderPage();

    expect(await screen.findByRole("link", { name: /の開催詳細$/u })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "開催を作成" }));
    const dialog = screen.getByRole("dialog", { name: "新しい開催を作成" });
    await user.click(within(dialog).getByRole("button", { name: "開催を作成" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "予期しないエラーが発生しました。もう一度お試しください。",
    );

    const cancelButton = within(dialog).getByRole("button", { name: "キャンセル" });
    // The API error can render before the form action has finished clearing pending.
    await waitFor(() => expect(cancelButton).toBeEnabled());
    await user.click(cancelButton);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "新しい開催を作成" })).not.toBeInTheDocument(),
    );
    const surface = screen.getByRole("region", { name: "開催履歴" });
    expect(within(surface).getByRole("alert")).toHaveTextContent(
      "操作に失敗しました予期しないエラーが発生しました。もう一度お試しください。",
    );
  });

  it("deletes an empty held event after confirmation", async () => {
    matchMedia = installMatchMediaController(true);
    const heldEvents = [makeHeldEventResponse({ id: "held-empty" })];
    let idempotencyKey: string | null = null;
    server.use(
      http.get("/api/held-events", () => HttpResponse.json({ items: heldEvents })),
      http.delete("/api/held-events/:heldEventId", ({ params, request }) => {
        idempotencyKey = request.headers.get("Idempotency-Key");
        const heldEventId = String(params["heldEventId"]);
        heldEvents.splice(
          heldEvents.findIndex((event) => event.id === heldEventId),
          1,
        );
        return HttpResponse.json({ deleted: true, heldEventId });
      }),
    );

    renderPage();

    const deleteButton = await screen.findByRole("button", { name: /を削除$/u });
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);
    expect(screen.getByText("開催を削除しますか？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除する" }));

    await screen.findByText("開催履歴はまだありません");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText("開催を削除しました。")).toBeInTheDocument();
    expect(idempotencyKey).toMatch(/\S/u);
  });

  it("updates a previously visited detail after deleting its neighbor through the list", async () => {
    matchMedia = installMatchMediaController(true);
    const oldEvent = makeHeldEventResponse({ id: "held-old", heldAt: "2026-01-01T00:00:00Z" });
    const current = makeHeldEventResponse({ id: "held-current", heldAt: "2026-01-02T00:00:00Z" });
    let removed = false;
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({ items: removed ? [current] : [current, oldEvent] }),
      ),
      http.get("/api/held-events/held-current", () =>
        HttpResponse.json(
          makeHeldEventDetailResponse({
            ...current,
            navigation: removed ? {} : { previous: { id: oldEvent.id, heldAt: oldEvent.heldAt } },
          }),
        ),
      ),
      http.delete("/api/held-events/held-old", () => {
        removed = true;
        return HttpResponse.json({ deleted: true, heldEventId: oldEvent.id });
      }),
    );
    renderPage("/held-events/held-current", true);
    expect(await screen.findByRole("link", { name: /前の開催/u })).toHaveAttribute(
      "href",
      "/held-events/held-old",
    );
    await user.click(screen.getByRole("link", { name: "開催履歴へ戻る" }));
    await user.click(await screen.findByRole("button", { name: "2026/01/01 09:00を削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(screen.queryByText("開催を削除しますか？")).not.toBeInTheDocument());
    await user.click(screen.getByRole("link", { name: "2026/01/02 09:00の開催詳細" }));
    expect(await screen.findByText("最初の開催です")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /前の開催/u })).not.toBeInTheDocument();
    expect(queryClient.getQueryData(heldEventKeys.detail(oldEvent.id))).toBeUndefined();
  });

  it("keeps a pending deletion on its owning page and cancels the blocked back request", async () => {
    setDevUser();
    const gate = createDeferred();
    let deleted = false;
    const event = makeHeldEventResponse({ draftCount: 0, matchCount: 0 });
    server.use(
      http.get("/api/held-events", () => HttpResponse.json({ items: deleted ? [] : [event] })),
      http.delete("/api/held-events/:heldEventId", async () => {
        await gate.promise;
        deleted = true;
        return HttpResponse.json({ deleted: true, heldEventId: event.id });
      }),
    );
    const router = createMemoryRouter(
      [
        { path: "/held-events", element: <HeldEventsPage /> },
        { path: "/matches", element: <p>matches</p> },
      ],
      { initialEntries: ["/matches", "/held-events"] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /を削除$/u }));
    await user.click(screen.getByRole("button", { name: "削除する" }));
    expect(screen.getByRole("button", { name: "削除中…" })).toBeDisabled();
    await act(async () => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/held-events");
    await act(async () => gate.resolve());
    await screen.findByText("開催履歴はまだありません");
    await waitFor(() => expect(screen.getByRole("button", { name: "更新" })).toBeEnabled());
    expect(router.state.location.pathname).toBe("/held-events");
    await act(async () => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/matches");
  });

  it("keeps deletion disabled for events with confirmed matches", async () => {
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({
          items: [makeHeldEventResponse({ id: "held-used", matchCount: 2 })],
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText("2試合")).toBeInTheDocument();
    expect(screen.queryByText("held-used")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /を削除$/u })).not.toBeInTheDocument();
    expect(screen.queryByText("第3試合")).not.toBeInTheDocument();
  });

  it("keeps deletion unavailable while an active draft references the event", async () => {
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({
          items: [makeHeldEventResponse({ draftCount: 1, id: "held-draft", nextMatchNo: 2 })],
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText("1件")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /を削除$/u })).not.toBeInTheDocument();
  });

  it("shows API conflicts when a draft still references the held event", async () => {
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({
          items: [makeHeldEventResponse({ id: "held-draft" })],
        }),
      ),
      http.delete("/api/held-events/:heldEventId", () =>
        HttpResponse.json(
          {
            code: "CONFLICT",
            detail: "held event has match drafts.",
            status: 409,
            title: "Conflict",
            type: "about:blank",
          },
          { status: 409 },
        ),
      ),
    );

    renderPage();

    const deleteButton = await screen.findByRole("button", { name: /を削除$/u });
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);
    expect(screen.getByText("開催を削除しますか？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存済みの状態が変わっています。内容を確認して、もう一度実行してください。",
    );
    expect(screen.getByRole("button", { name: "削除する" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    await waitFor(() => expect(screen.queryByText("開催を削除しますか？")).not.toBeInTheDocument());
    expect(screen.queryByText("held event has match drafts.")).not.toBeInTheDocument();
    expect(screen.queryByText("操作に失敗しました")).not.toBeInTheDocument();
  });
});
