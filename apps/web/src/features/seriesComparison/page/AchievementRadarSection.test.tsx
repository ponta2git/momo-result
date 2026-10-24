import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AchievementRadarSection } from "@/features/seriesComparison/page/AchievementRadarSection";
import { achievementKeys } from "@/shared/api/achievementQueryOptions";
import { playerRadarAggregateDisplay } from "@/shared/seriesAnalysis/playerRadarDisplay";
import { makeAchievedResource } from "@/test/msw/achievementFixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

describe("AchievementRadarSection", () => {
  it("keeps a complete seven-axis snapshot after a new achievement resource fails instead of combining revisions", async () => {
    const client = createTestQueryClient();
    const resource = makeAchievedResource();
    client.setQueryData(
      achievementKeys.publication(resource.gameTitleId, resource.artifact.artifactId),
      resource,
    );
    const original = playerRadarAggregateDisplay(makeSeriesAnalysisAggregate());
    const radar = {
      ...original,
      players: original.players.map((player) => ({
        ...player,
        axes: player.axes.map((axis) => ({ ...axis, score: 7 })),
      })),
    };
    const next = {
      ...radar,
      players: radar.players.map((player) => ({
        ...player,
        axes: player.axes.map((axis) => ({ ...axis, score: 2 })),
      })),
    };
    server.use(
      http.get("/api/achievements", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Unavailable",
            code: "SERVICE_UNAVAILABLE",
            status: 503,
            detail: "unavailable",
          },
          { status: 503 },
        ),
      ),
    );
    const view = (artifactId: string, current: typeof radar) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AchievementRadarSection
            gameTitleId={resource.gameTitleId}
            artifactId={artifactId}
            radar={current}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(view(resource.artifact.artifactId, radar));
    expect(screen.getByRole("img", { name: "ぽんたの7軸レーダー" })).toHaveAccessibleDescription(
      /平均順位：7点.*実績達成：10点/u,
    );
    rerender(view("artifact-next", next));
    expect(await screen.findByText("実績達成の数値を取得できません")).toBeVisible();
    expect(screen.getByRole("img", { name: "ぽんたの7軸レーダー" })).toHaveAccessibleDescription(
      /平均順位：7点.*実績達成：10点/u,
    );
    expect(
      screen.getByRole("img", { name: "ぽんたの7軸レーダー" }),
    ).not.toHaveAccessibleDescription(/平均順位：2点/u);
  });
});
