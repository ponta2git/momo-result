import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { MatchEditPage } from "@/features/matches/workspace/MatchEditPage";
import { setDevUser } from "@/test/auth";
import { makeFourPlayerResults, makeMatchDetail } from "@/test/factories";
import { makeAchievementCatalog, makeAchievementItem } from "@/test/msw/achievementFixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

describe("Match achievement saves", () => {
  it.each([false, true])(
    "saves selected achievements with resultChanged=%s through the appropriate atomic endpoint",
    async (resultChanged) => {
      setDevUser();
      const user = userEvent.setup();
      const requests: Array<{ path: string; body: unknown }> = [];
      server.use(
        http.get("/api/matches/match-1", () =>
          HttpResponse.json(makeMatchDetail({ version: "11", players: makeFourPlayerResults() })),
        ),
        http.get("/api/achievements/catalog", () =>
          HttpResponse.json(makeAchievementCatalog({ items: [makeAchievementItem()] })),
        ),
        http.post("/api/matches/match-1/achievements", async ({ request }) => {
          requests.push({ path: "achievements", body: await request.json() });
          return HttpResponse.json({ saved: true });
        }),
        http.put("/api/matches/match-1", async ({ request }) => {
          requests.push({ path: "result", body: await request.json() });
          return HttpResponse.json({ matchId: "match-1" });
        }),
      );
      const router = createMemoryRouter(
        [
          { path: "/matches/:matchId/edit", element: <MatchEditPage /> },
          { path: "/matches/:matchId", element: <h1>保存後の試合</h1> },
        ],
        { initialEntries: ["/matches/match-1/edit"] },
      );
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
      expect(await screen.findByRole("button", { name: "開催（必須）を変更" })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "試合と一緒に実績を記録" }));
      await user.click(await screen.findByRole("checkbox", { name: "手入力のテスト実績・ぽんた" }));
      if (resultChanged) {
        await user.clear(screen.getByLabelText("試合番号"));
        await user.type(screen.getByLabelText("試合番号"), "2");
      }
      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByRole("heading", { name: "保存後の試合" })).toBeVisible();
      const achievements = [
        {
          achievementId: "achievement-manual",
          memberId: "member_ponta",
          expectedItemVersion: "1",
          expectedClaimVersion: null,
        },
      ];
      if (resultChanged) {
        expect(requests).toEqual([
          {
            path: "result",
            body: expect.objectContaining({
              achievements,
              expectedVersion: "11",
              matchNoInEvent: 2,
              players: makeFourPlayerResults(),
            }),
          },
        ]);
      } else {
        expect(requests).toEqual([
          { path: "achievements", body: { expectedMatchVersion: "11", achievements } },
        ]);
      }
    },
  );
});
