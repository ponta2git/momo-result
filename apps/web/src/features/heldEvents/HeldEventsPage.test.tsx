import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("renders held events with match and export links", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "開催履歴" })).toBeInTheDocument();
    expect(await screen.findByText("0試合")).toBeInTheDocument();
    expect(screen.queryByText("held-1")).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "試合" })).toHaveAttribute(
      "href",
      "/matches?heldEventId=held-1",
    );
    expect(screen.getByRole("link", { name: "出力" })).toHaveAttribute(
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
            pageSize: 25,
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
        const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
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
    expect(await screen.findByRole("link", { name: "試合" })).toBeInTheDocument();
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
            pageSize: 25,
            totalItems: 1,
            totalPages: 1,
          },
          totalMatchCount: 0,
        });
      }),
    );

    renderPage("/held-events?page=2abc&pageSize=50x");

    expect(await screen.findByRole("link", { name: "試合" })).toBeInTheDocument();
    expect(captured?.searchParams.get("page")).toBe("1");
    expect(captured?.searchParams.get("pageSize")).toBe("25");
  });

  it("creates a held event and adds it to the visible list", async () => {
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

    expect(await screen.findByRole("link", { name: "試合" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("開催日時"));
    await user.type(screen.getByLabelText("開催日時"), "2026-01-02T12:04");
    await user.click(screen.getByRole("button", { name: "開催履歴を作成" }));

    await waitFor(() => expect(screen.getAllByRole("link", { name: "試合" })).toHaveLength(2));
    expect(screen.queryByText("held-created")).not.toBeInTheDocument();
    expect(screen.getByText("2開催 / 0試合")).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: "削除" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByText("開催履歴を削除しますか？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除する" }));

    await screen.findByText("開催履歴はまだありません");
    expect(screen.getByText("0開催 / 0試合")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
    expect(screen.getByText("試合あり")).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: "削除" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByText("開催履歴を削除しますか？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("held event has match drafts.");
    expect(screen.getByRole("button", { name: "削除する" })).toBeInTheDocument();
  });
});
