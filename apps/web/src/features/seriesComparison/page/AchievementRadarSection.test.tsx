import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AchievementRadarSection } from "@/features/seriesComparison/page/AchievementRadarSection";
import { achievementKeys } from "@/shared/api/achievementQueryOptions";
import type { AchievementResource } from "@/shared/api/achievements";
import { playerRadarAggregateDisplay } from "@/shared/seriesAnalysis/playerRadarDisplay";
import { makeAchievedResource } from "@/test/msw/achievementFixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

const scoringCases: Array<{
  label: string;
  curve: AchievementResource["achievementCurve"];
  score: number;
  explanation: string;
}> = [
  {
    label: "point boundaries",
    curve: { pointThresholds: [10, 20, 40, 60, 80, 100, 125, 150, 200] },
    score: 3,
    explanation: "獲得ポイントが設定された境界に達するごとに、1〜10点で段階的に採点します。",
  },
  {
    label: "explicit legacy percentages",
    curve: { thresholds: [0, 10, 25, 50, 80] },
    score: 4.6,
    explanation: "従来の得点率基準で1〜10点を表示します。",
  },
];

describe("AchievementRadarSection", () => {
  it.each(scoringCases)(
    "uses the published $label without a six-axis basis",
    async ({ curve, score, explanation }) => {
      const user = userEvent.setup();
      const client = createTestQueryClient();
      const resource = makeAchievedResource();
      resource.achievementCurve = curve;
      resource.summaries.forEach((summary) => {
        summary.totalPoints = 100;
        const ponta = summary.players.find((player) => player.memberId === "member_ponta")!;
        ponta.earnedPoints = 22;
        ponta.score = score;
      });
      client.setQueryData(
        achievementKeys.publication(resource.gameTitleId, resource.artifact.artifactId),
        resource,
      );
      const radar = playerRadarAggregateDisplay(makeSeriesAnalysisAggregate());
      radar.basis = null;
      radar.players.forEach((player) => {
        player.axes.forEach((axis) => {
          axis.score = null;
          axis.scoreUnavailableReasons = ["basis_unavailable"];
        });
      });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <AchievementRadarSection
              gameTitleId={resource.gameTitleId}
              artifactId={resource.artifact.artifactId}
              radar={radar}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      expect(screen.getByRole("img", { name: "ぽんたの7軸レーダー" })).toHaveAccessibleDescription(
        expect.stringContaining(`実績達成：${score}点`),
      );
      await user.click(screen.getByRole("button", { name: "レーダーの採点基準" }));
      expect(screen.getByText(explanation, { exact: false })).toBeVisible();
    },
  );

  it("keeps a complete seven-axis snapshot after a new achievement resource fails instead of combining revisions", async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole("button", { name: "プレーヤーレーダーの数値を表で見る" }));
    expect(screen.getByRole("link", { name: "実績リストを開く" })).toHaveAttribute(
      "href",
      "/achievements?gameTitleId=gt_momotetsu_2",
    );
  });
});
