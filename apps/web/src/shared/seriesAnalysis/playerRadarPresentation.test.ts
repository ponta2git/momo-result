// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  formatPlayerRadarBoundary,
  formatPlayerRadarRawValue,
} from "@/shared/seriesAnalysis/playerRadarPresentation";

describe("player radar values", () => {
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
