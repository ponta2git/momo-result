// @vitest-environment node
import { describe, expect, it } from "vitest";

import { playerRadarEvaluationDisplay } from "@/shared/seriesAnalysis/playerRadarDisplay";
import {
  makePlayerRadarAchievements,
  makePlayerRadarEvaluation,
} from "@/test/msw/playerRadarFixtures";

describe("player radar achievement publication display", () => {
  it.each(["points", "legacy"] as const)(
    "keeps the explicit %s curve and scores when there is no six-axis basis",
    (mode) => {
      const achievements = makePlayerRadarAchievements();
      if (mode === "points") {
        achievements.achievementCurve = {
          pointThresholds: [10, 20, 40, 60, 80, 100, 125, 150, 200],
        };
        achievements.summary.players.forEach((player, index) => {
          player.score = [4, 3, 2, 1][index]!;
        });
      }
      const display = playerRadarEvaluationDisplay(
        makePlayerRadarEvaluation(),
        null,
        [],
        [],
        achievements,
      );
      expect(display.basis).toBeNull();
      expect(display.achievementCurve).toEqual(achievements.achievementCurve);
      for (const player of display.players) {
        const published = achievements.summary.players.find(
          (entry) => entry.memberId === player.memberId,
        )!;
        expect(player.achievement).toEqual({
          earnedPoints: published.earnedPoints,
          totalPoints: achievements.summary.totalPoints,
          score: published.score,
        });
      }
    },
  );
});
