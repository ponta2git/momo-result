import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { HeldEventsPage } from "@/features/heldEvents/HeldEventsPage";
import { setDevUser } from "@/test/auth";
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
          <Route element={<p>exports</p>} path="/exports" />
        </Routes>
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

  it("renders held events as a concise ledger with status and related links", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "開催履歴" })).toBeInTheDocument();
    expect(await screen.findByText("最新")).toBeInTheDocument();
    expect(screen.getByText("確定済み")).toBeInTheDocument();
    expect(screen.getByText("0件")).toBeInTheDocument();
    expect(screen.queryByText("次の番号")).not.toBeInTheDocument();
    expect(screen.queryByText("第1試合")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "開催回一覧" })).not.toBeInTheDocument();
    expect(screen.queryByText(/開催を開くと/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/開催ごとに試合順/u)).not.toBeInTheDocument();
    expect(screen.queryByText("held-1")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /の開催詳細$/u })).toHaveAttribute(
      "href",
      "/held-events/held-1",
    );
    expect(screen.getByRole("link", { name: /の試合を検索$/u })).toHaveAttribute(
      "href",
      "/matches?heldEventId=held-1",
    );
    expect(screen.getByRole("link", { name: /をCSV出力$/u })).toHaveAttribute(
      "href",
      "/exports?heldEventId=held-1&format=csv",
    );
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
    expect(screen.queryByRole("navigation", { name: "ページネーション" })).not.toBeInTheDocument();
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

  it("offers 10, 25, and 50 as held-event page sizes", async () => {
    renderPage();

    const pageSizeSelect = await screen.findByLabelText("表示件数");
    expect([...pageSizeSelect.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "10",
      "25",
      "50",
    ]);
    expect(pageSizeSelect).toHaveValue("10");

    await user.selectOptions(pageSizeSelect, "25");

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("pageSize=25"),
    );
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

  it("keeps creation secondary until requested and allows cancelling", async () => {
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

  it("deletes an empty held event after confirmation", async () => {
    const heldEvents = [makeHeldEventResponse({ id: "held-empty" })];
    server.use(
      http.get("/api/held-events", () => HttpResponse.json({ items: heldEvents })),
      http.delete("/api/held-events/:heldEventId", ({ params }) => {
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
    expect(screen.getByText("開催履歴を削除しますか？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除する" }));

    await screen.findByText("開催履歴はまだありません");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText("開催履歴を削除しました。")).toBeInTheDocument();
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
    expect(screen.getByText("開催履歴を削除しますか？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("held event has match drafts.");
    expect(screen.getByRole("button", { name: "削除する" })).toBeInTheDocument();
  });
});
