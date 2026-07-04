// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  headToHeadCellTone,
  headToHeadToneLabel,
  shouldShowRankStripMatchMarker,
} from "./charts/SeriesComparisonCharts";

describe("headToHeadToneLabel", () => {
  it("maps API head-to-head signals to display labels", () => {
    expect(headToHeadToneLabel("strong_advantage")).toBe("優勢");
    expect(headToHeadToneLabel("slight_advantage")).toBe("やや優勢");
    expect(headToHeadToneLabel("neutral")).toBe("互角");
    expect(headToHeadToneLabel("slight_disadvantage")).toBe("やや劣勢");
    expect(headToHeadToneLabel("strong_disadvantage")).toBe("劣勢");
    expect(headToHeadToneLabel("reference")).toBe("参考");
    expect(headToHeadToneLabel("no_target")).toBe("判定なし");
  });
});

describe("headToHeadCellTone", () => {
  it("uses neutral styling for neutral or non-judged signals", () => {
    expect(headToHeadCellTone("neutral", 0.5).color).toBe("var(--color-tray-incident)");
    expect(headToHeadCellTone("neutral", 0.5).alpha).toBeLessThan(0.2);
    expect(headToHeadCellTone("reference", 1).color).toBe("var(--color-tray-incident)");
    expect(headToHeadCellTone("no_target", null).alpha).toBe(0);
  });

  it("uses directional styling for advantage and disadvantage signals", () => {
    expect(headToHeadCellTone("slight_advantage", 0.55).color).toBe("var(--color-action)");
    expect(headToHeadCellTone("strong_advantage", 0.65).color).toBe("var(--color-action)");
    expect(headToHeadCellTone("slight_disadvantage", 0.45).color).toBe("var(--color-danger)");
    expect(headToHeadCellTone("strong_disadvantage", 0.35).color).toBe("var(--color-danger)");
    expect(headToHeadCellTone("slight_disadvantage", 0.49, -0.1875).color).toBe(
      "var(--color-danger)",
    );
    expect(headToHeadCellTone("slight_advantage", 0.51, 0.1875).color).toBe("var(--color-action)");
  });
});

describe("shouldShowRankStripMatchMarker", () => {
  it("marks the first point, every fifth match, and the latest point", () => {
    expect(shouldShowRankStripMatchMarker(1, 0, 12)).toBe(true);
    expect(shouldShowRankStripMatchMarker(2, 1, 12)).toBe(false);
    expect(shouldShowRankStripMatchMarker(5, 4, 12)).toBe(true);
    expect(shouldShowRankStripMatchMarker(10, 9, 12)).toBe(true);
    expect(shouldShowRankStripMatchMarker(12, 11, 12)).toBe(true);
  });
});
