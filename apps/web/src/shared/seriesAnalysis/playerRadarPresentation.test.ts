import { describe, expect, it } from "vitest";

import {
  achievementRadarScore,
  achievementCurveThresholds,
  playerRadarAchievementCurve,
  defaultAchievementCurve,
  formatPlayerRadarBoundary,
  formatPlayerRadarRawValue,
  playerRadarSettingCell,
  playerRadarSettingThresholds,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
// @vitest-environment node
import { pointAchievementCurveFixture } from "@/test/msw/playerRadarFixtures";

describe("player radar values", () => {
  it("does not create scores or thresholds when the achievement curve is unavailable", () => {
    expect(playerRadarAchievementCurve(null)).toEqual({ unavailableReason: "basis_unavailable" });
    for (const unavailableReason of [
      "basis_unavailable",
      "no_target",
      "degenerate_distribution",
    ] as const) {
      const curve = { unavailableReason };
      expect(achievementCurveThresholds(curve)).toEqual([]);
      expect(achievementRadarScore({ earnedPoints: 50, totalPoints: 100 }, curve)).toBeNull();
    }
    const cell = playerRadarSettingCell(
      {
        memberId: "member_ponta",
        displayName: "ぽんた",
        axes: [],
        achievement: { earnedPoints: 0, totalPoints: 100, score: null },
      },
      "achievement",
    );
    expect(cell?.rawValue).toBe(0);
    expect(cell?.score).toBeNull();
    expect(cell?.scoreUnavailableReasons).toEqual(["basis_unavailable"]);
  });

  it("scores point boundaries inclusively in integer steps independently of the total available points", () => {
    for (const [earnedPoints, score] of [
      [0, 1],
      [4.999, 1],
      [5, 2],
      [9.999, 2],
      [10, 3],
      [22, 4],
      [75, 7],
      [199.999, 9],
      [200, 10],
      [1000, 10],
    ] as const) {
      expect(
        achievementRadarScore({ earnedPoints, totalPoints: 1000 }, pointAchievementCurveFixture),
      ).toBe(score);
      expect(
        achievementRadarScore({ earnedPoints, totalPoints: 2000 }, pointAchievementCurveFixture),
      ).toBe(score);
    }
    expect(
      achievementRadarScore({ earnedPoints: 0, totalPoints: 0 }, pointAchievementCurveFixture),
    ).toBeNull();
  });

  it("keeps historical percentage interpolation and exposes earned points without recalculating a published score", () => {
    expect(
      achievementRadarScore({ earnedPoints: 65, totalPoints: 100 }, defaultAchievementCurve),
    ).toBe(8.5);
    expect(
      achievementRadarScore({ earnedPoints: 65, totalPoints: 200 }, defaultAchievementCurve),
    ).toBe(5.6);
    expect(playerRadarSettingThresholds(null, "achievement")).toEqual([]);
    const cell = playerRadarSettingCell(
      {
        memberId: "member_ponta",
        displayName: "ぽんた",
        axes: [],
        achievement: { earnedPoints: 22, totalPoints: 200, score: 3.13 },
      },
      "achievement",
    );
    expect(cell?.rawValue).toBe(22);
    expect(cell?.score).toBe(3.13);
    expect(formatPlayerRadarRawValue("achievement", cell?.rawValue ?? null)).toBe("22pt");
  });

  it("uses the same money units for performance and thresholds, identifying rounded boundaries", () => {
    expect(formatPlayerRadarRawValue("totalAssetsMedian", 12345.6)).toBe("1億2346万円");
    expect(formatPlayerRadarBoundary("totalAssetsMedian", 12345.6)).toBe("約1億2346万円以上");
    expect(formatPlayerRadarBoundary("totalAssetsP10", -10000)).toBe("-1億円以上");
    expect(formatPlayerRadarBoundary("revenueAverage", 0)).toBe("0万円以上");
  });

  it("keeps smaller ranks better and distinguishes a rounded boundary from an exact one", () => {
    expect(formatPlayerRadarRawValue("averageRank", 2.345)).toBe("2.35位");
    expect(formatPlayerRadarBoundary("averageRank", 2.345)).toBe("約2.35位以下");
    expect(formatPlayerRadarBoundary("averageRank", 2.25)).toBe("2.25位以下");
    expect(formatPlayerRadarRawValue("averageRank", null)).toBe("—");
  });
});
