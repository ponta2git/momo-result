import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { HeldEventsPage } from "@/features/heldEvents/HeldEventsPage";
import { server } from "@/shared/api/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

function renderPage(path = "/held-events") {
  window.localStorage.setItem("momoresult.devUser", "account_ponta");
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
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

describe("HeldEventsPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
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

  it("creates a held event and adds it to the visible list", async () => {
    const heldEvents = [{ id: "held-1", heldAt: "2026-01-01T00:00:00.000Z", matchCount: 0 }];
    const created = { id: "held-created", heldAt: "2026-01-02T03:04:00.000Z", matchCount: 0 };
    server.use(
      http.get("/api/held-events", () => HttpResponse.json({ items: heldEvents })),
      http.post("/api/held-events", () => {
        heldEvents.unshift(created);
        return HttpResponse.json(created);
      }),
    );

    renderPage();

    expect(await screen.findByRole("link", { name: "試合" })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("開催日時"));
    await userEvent.type(screen.getByLabelText("開催日時"), "2026-01-02T12:04");
    await userEvent.click(screen.getByRole("button", { name: "開催履歴を作成" }));

    await waitFor(() => expect(screen.getAllByRole("link", { name: "試合" })).toHaveLength(2));
    expect(screen.queryByText("held-created")).not.toBeInTheDocument();
    expect((await screen.findAllByText(/開催履歴（/u)).length).toBeGreaterThan(0);
  });

  it("deletes an empty held event after confirmation", async () => {
    const heldEvents = [{ id: "held-empty", heldAt: "2026-01-01T00:00:00.000Z", matchCount: 0 }];
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
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByText("開催履歴を削除しますか？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    await screen.findByText("開催履歴がまだありません");
    expect((await screen.findAllByText("開催履歴を削除しました。")).length).toBeGreaterThan(0);
  });

  it("keeps deletion disabled for events with confirmed matches", async () => {
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({
          items: [{ id: "held-used", heldAt: "2026-01-01T00:00:00.000Z", matchCount: 2 }],
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
          items: [{ id: "held-draft", heldAt: "2026-01-01T00:00:00.000Z", matchCount: 0 }],
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
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByText("開催履歴を削除しますか？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));

    expect((await screen.findAllByText(/held event has match drafts/u)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
  });
});
