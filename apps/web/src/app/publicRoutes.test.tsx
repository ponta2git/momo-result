import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import {
  loadHeldEventDetailPage,
  loadMatchDetailPage,
  loadMatchEditPage,
} from "@/app/routeModules";
import { appRoutes } from "@/app/router";
import type { UpdateMatchRequest } from "@/shared/api/matches";
import { setDevUser } from "@/test/auth";
import {
  makeFourPlayerResults,
  makeHeldEventDetailResponse,
  makeMatchDetail,
} from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function renderRoute(path: string) {
  const queryClient = createTestQueryClient();
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("public record routes", () => {
  beforeAll(async () => {
    await Promise.all([loadHeldEventDetailPage(), loadMatchDetailPage(), loadMatchEditPage()]);
  });

  it.each(["/m/1", "/e/9223372036854775807"])("requires sign in for %s", async (path) => {
    const router = renderRoute(path);
    expect(await screen.findByRole("region", { name: "ログイン" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/login");
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe(path);
  });

  it("reads a large public number, edits the returned legacy identity, and returns to its public URL", async () => {
    setDevUser();
    const user = userEvent.setup();
    const publicId = "9007199254740993";
    const requests: Array<{ id: string; body: UpdateMatchRequest }> = [];
    let record = makeMatchDetail({
      publicId,
      heldEventPublicId: "9223372036854775807",
      players: makeFourPlayerResults(),
    });
    server.use(
      http.get("/api/public/matches/:publicId", ({ params }) => {
        expect(params["publicId"]).toBe(publicId);
        return HttpResponse.json(record);
      }),
      http.get("/api/matches/match-1", () => HttpResponse.json(record)),
      http.put("/api/matches/:matchId", async ({ params, request }) => {
        const body = (await request.json()) as UpdateMatchRequest;
        requests.push({ id: String(params["matchId"]), body });
        record = { ...record, ...body };
        return HttpResponse.json({ matchId: record.matchId, updatedAt: "2026-04-04T14:00:00Z" });
      }),
    );
    const router = renderRoute(`/m/${publicId}`);
    expect(await screen.findByRole("heading", { name: "第1試合の結果" })).toBeVisible();
    expect(screen.getByRole("link", { name: "この試合の開催を見る" })).toHaveAttribute(
      "href",
      "/e/9223372036854775807",
    );
    expect(screen.getByRole("link", { name: "この試合を出力" })).toHaveAttribute(
      "href",
      "/exports?matchId=match-1",
    );
    const edit = screen.getByRole("link", { name: "試合結果を編集" });
    expect(edit).toHaveAttribute("href", "/matches/match-1/edit");
    await user.click(edit);
    expect(await screen.findByRole("button", { name: "開催（必須）を変更" })).toBeEnabled();
    const matchNo = screen.getByLabelText("試合番号");
    await user.clear(matchNo);
    await user.type(matchNo, "9");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("heading", { name: "第9試合の結果" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/m/${publicId}`);
    expect(requests).toEqual([
      {
        id: "match-1",
        body: expect.objectContaining({ heldEventId: "held-1", matchNoInEvent: 9 }),
      },
    ]);
  });

  it("keeps numeric legacy routes distinct and builds new event links from exact public strings", async () => {
    setDevUser();
    const user = userEvent.setup();
    const first = makeHeldEventDetailResponse({
      id: "held-public-one",
      publicId: "1",
      matchCount: 1,
      nextMatchNo: 2,
      matches: [
        {
          matchId: "match-public-one",
          publicId: "9007199254740993",
          matchNoInEvent: 1,
          gameTitleId: "gt_momotetsu_2",
          seasonMasterId: "season_current",
          mapMasterId: "map_east",
          ownerMemberId: "member_ponta",
          playedAt: "2026-01-01T00:00:00Z",
          players: makeFourPlayerResults(),
        },
      ],
      navigation: { next: { id: "1", publicId: "2", heldAt: "2026-01-02T00:00:00Z" } },
    });
    const collision = makeHeldEventDetailResponse({
      id: "1",
      publicId: "2",
      heldAt: "2026-01-02T00:00:00Z",
      nextMatchNo: 7,
    });
    server.use(
      http.get("/api/public/held-events/:publicId", ({ params }) =>
        HttpResponse.json(params["publicId"] === "1" ? first : collision),
      ),
      http.get("/api/held-events/1", () => HttpResponse.json(collision)),
      http.get("/api/matches/1", () =>
        HttpResponse.json(makeMatchDetail({ matchId: "1", publicId: "2", matchNoInEvent: 8 })),
      ),
      http.get("/api/public/matches/1", () =>
        HttpResponse.json(
          makeMatchDetail({ matchId: "match-public-one", publicId: "1", matchNoInEvent: 3 }),
        ),
      ),
    );
    const router = renderRoute("/e/1");
    expect(await screen.findByRole("heading", { name: "2026/01/01 09:00" })).toBeVisible();
    expect(screen.getByRole("link", { name: "手入力" })).toHaveAttribute(
      "href",
      "/matches/new?heldEventId=held-public-one",
    );
    expect(screen.getByRole("link", { name: "CSV出力" })).toHaveAttribute(
      "href",
      "/exports?heldEventId=held-public-one&format=csv",
    );
    expect(screen.getByRole("link", { name: "第1試合の結果を見る" })).toHaveAttribute(
      "href",
      "/m/9007199254740993",
    );
    await user.click(screen.getByRole("link", { name: /次の開催/u }));
    expect(await screen.findByRole("heading", { name: "2026/01/02 09:00" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/e/2");
    await act(async () => {
      await router.navigate("/held-events/1");
    });
    expect(await screen.findByRole("heading", { name: "第7試合を記録" })).toBeVisible();
    await act(async () => {
      await router.navigate("/matches/1");
    });
    expect(await screen.findByRole("heading", { name: "第8試合の結果" })).toBeVisible();
    await act(async () => {
      await router.navigate("/m/1");
    });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "第3試合の結果" })).toBeVisible(),
    );
  });
});
