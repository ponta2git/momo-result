import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { HeldEventsPage } from "@/features/heldEvents/HeldEventsPage";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeHeldEventResponse } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(path = "/held-events") {
  setDevUser();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route element={<HeldEventsPage />} path="/held-events" />
          <Route element={<p>held event detail</p>} path="/held-events/:heldEventId" />
          <Route element={<p>matches</p>} path="/matches" />
          <Route element={<p>ocr capture</p>} path="/ocr/new" />
          <Route element={<p>exports</p>} path="/exports" />
        </Routes>
        <ToastHost />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;

describe("HeldEventsPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("renders held-event status and related links", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "開催履歴" })).toBeInTheDocument();
    expect(await screen.findByText("最新")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "開催履歴" })).toBeInTheDocument();
    expect(screen.getByText("確定済み")).toBeInTheDocument();
    expect(screen.getByText("0件")).toBeInTheDocument();
    expect(screen.queryByText("held-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "開催を作成" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /の開催詳細$/u })).toHaveAttribute(
      "href",
      "/held-events/held-1?returnTo=%2Fheld-events",
    );
    expect(screen.getByRole("link", { name: /の試合を検索$/u })).toHaveAttribute(
      "href",
      "/matches?heldEventId=held-1&sort=match_no_asc&returnTo=%2Fheld-events",
    );
    expect(screen.getByRole("link", { name: /をCSV出力$/u })).toHaveAttribute(
      "href",
      "/exports?heldEventId=held-1&format=csv&returnTo=%2Fheld-events",
    );
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

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "開催履歴" })).toHaveAttribute("aria-busy", "true"),
    );
    const ledger = screen.getByRole("region", { name: "開催履歴" });
    expect(within(ledger).getByRole("status")).toHaveTextContent("開催履歴を更新中");
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
    const heldEvents = [makeHeldEventResponse()];
    const created = makeHeldEventResponse({
      heldAt: "2026-01-02T03:04:00.000Z",
      id: "held-created",
    });
    server.use(
      http.get("/api/held-events", () => HttpResponse.json({ items: heldEvents })),
      http.post("/api/held-events", () => {
        heldEvents.unshift(created);
        return HttpResponse.json(created);
      }),
    );

    renderPage();

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
    expect(screen.getByText("held event detail")).toBeInTheDocument();
    expect(queryClient.getQueryData(["held-events", "detail", "held-created"])).toMatchObject({
      draftCount: 0,
      id: "held-created",
      matches: [],
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

    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "新しい開催を作成" })).not.toBeInTheDocument(),
    );
    const surface = screen.getByRole("region", { name: "開催履歴" });
    expect(within(surface).getByRole("alert")).toHaveTextContent(
      "操作に失敗しました予期しないエラーが発生しました。もう一度お試しください。",
    );
  });

  it("deletes an empty held event after confirmation", async () => {
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
