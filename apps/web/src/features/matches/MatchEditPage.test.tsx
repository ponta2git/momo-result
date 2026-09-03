import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { MatchEditPage } from "@/features/matches/MatchEditPage";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

let user: ReturnType<typeof userEvent.setup>;

describe("MatchEditPage", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("starts the match detail and independent directories before any directory resolves", async () => {
    setDevUser();
    const directoryGate = createDeferred();
    const requested = new Set<string>();
    server.use(
      http.get("/api/held-events", async () => {
        requested.add("held-events");
        await directoryGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/game-titles", async () => {
        requested.add("game-titles");
        await directoryGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/member-aliases", async () => {
        requested.add("member-aliases");
        await directoryGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/matches/:matchId", ({ params }) => {
        requested.add("match-detail");
        return HttpResponse.json(makeMatchDetail({ matchId: String(params["matchId"]) }));
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(requested).toEqual(
        new Set(["held-events", "game-titles", "member-aliases", "match-detail"]),
      ),
    );
    directoryGate.resolve();
    expect(await screen.findByRole("heading", { name: "試合を編集" })).toBeInTheDocument();
  });

  it("shows a structured loading shell while the saved match is loading", async () => {
    setDevUser();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/matches/:matchId", async ({ params }) => {
        await responseGate.promise;
        return HttpResponse.json({
          createdAt: "2026-01-01T00:00:00.000Z",
          createdByMemberId: "member_ponta",
          gameTitleId: "gt_momotetsu_2",
          heldEventId: "held-1",
          layoutFamily: "momotetsu_2",
          mapMasterId: "map_east",
          matchId: params["matchId"],
          matchNoInEvent: 1,
          ownerMemberId: "member_ponta",
          playedAt: "2026-01-01T00:00:00.000Z",
          players: [
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_ponta",
              playOrder: 1,
              rank: 1,
              revenueManYen: 200,
              totalAssetsManYen: 1000,
            },
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_akane_mami",
              playOrder: 2,
              rank: 2,
              revenueManYen: 150,
              totalAssetsManYen: 800,
            },
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_otaka",
              playOrder: 3,
              rank: 3,
              revenueManYen: 100,
              totalAssetsManYen: 600,
            },
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_eu",
              playOrder: 4,
              rank: 4,
              revenueManYen: 50,
              totalAssetsManYen: 400,
            },
          ],
          seasonMasterId: "season_current",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/matches/match-1/edit?returnTo=%2Fmatches%3Fcursor%3Dcursor-2"]}
        >
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText("試合編集を読み込み中")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "試合編集を読み込み中" })).toBeInTheDocument();

    responseGate.resolve();
    expect(await screen.findByRole("heading", { name: "試合を編集" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "編集をやめる" })).toHaveAttribute(
      "href",
      "/matches?cursor=cursor-2",
    );
  });

  it("loads the next match instead of retaining edited state when the route id changes", async () => {
    setDevUser();
    const secondMatchGate = createDeferred();
    server.use(
      http.get("/api/matches/:matchId", async ({ params }) => {
        const matchId = String(params["matchId"]);
        if (matchId === "match-2") {
          await secondMatchGate.promise;
        }
        return HttpResponse.json(
          makeMatchDetail({ matchId, matchNoInEvent: matchId === "match-2" ? 2 : 1 }),
        );
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
          <Link to="/matches/match-2/edit">別の試合を編集</Link>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合を編集" })).toBeInTheDocument();
    const matchNumber = screen.getByLabelText("試合番号");
    await user.clear(matchNumber);
    await user.type(matchNumber, "9");

    await user.click(screen.getByRole("link", { name: "別の試合を編集" }));

    expect(await screen.findByLabelText("試合編集を読み込み中")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "試合を編集" })).not.toBeInTheDocument();

    secondMatchGate.resolve();
    expect(await screen.findByRole("heading", { name: "試合を編集" })).toBeInTheDocument();
    expect(screen.getByLabelText("試合番号")).toHaveValue("2");
  });

  it("offers retry when the saved match cannot be loaded", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false } });
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const failureHeading = await screen.findByRole("heading", {
      level: 1,
      name: "試合編集を読み込めませんでした",
    });
    expect(failureHeading.closest("header")).toHaveTextContent(
      "確定済みの試合記録を編集します。保存後は一覧と出力に反映されます。",
    );
    expect(screen.getByRole("button", { name: "試合編集を再読み込み" })).toBeEnabled();
  });

  it("distinguishes a missing match from a retryable edit load failure", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false } });
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json({ detail: "match not found" }, { status: 404 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/missing/edit"]}>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const missingHeading = await screen.findByRole("heading", {
      level: 1,
      name: "試合が見つかりませんでした",
    });
    expect(missingHeading.closest("header")).toHaveTextContent(
      "確定済みの試合記録を編集します。保存後は一覧と出力に反映されます。",
    );
    expect(screen.queryByRole("button", { name: "試合編集を再読み込み" })).not.toBeInTheDocument();
  });

  it("keeps edited values and shows an update API failure in the execution area", async () => {
    setDevUser();
    server.use(
      http.put("/api/matches/:matchId", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合を編集" })).toBeInTheDocument();
    const matchNumber = screen.getByLabelText("試合番号");
    expect(matchNumber).toHaveValue("1");
    await user.click(screen.getByRole("button", { name: "保存" }));

    const failure = await screen.findByRole("heading", { name: "変更を保存できませんでした" });
    expect(failure.closest("section")).toHaveTextContent("入力内容は保持しています");
    expect(matchNumber).toHaveValue("1");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });
});
