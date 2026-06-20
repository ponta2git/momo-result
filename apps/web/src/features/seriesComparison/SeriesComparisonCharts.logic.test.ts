// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  headToHeadCellTone,
  headToHeadToneLabel,
  shouldShowRankStripMatchMarker,
} from "./SeriesComparisonCharts";

describe("headToHeadToneLabel", () => {
  it("uses early-scope battle significance thresholds", () => {
    expect(headToHeadToneLabel(0.8, 3)).toBe("優勢");
    expect(headToHeadToneLabel(0.65, 3)).toBe("優勢");
    expect(headToHeadToneLabel(0.55, 3)).toBe("やや優勢");
    expect(headToHeadToneLabel(0.5, 3)).toBe("互角");
    expect(headToHeadToneLabel(0.45, 3)).toBe("やや劣勢");
    expect(headToHeadToneLabel(0.35, 3)).toBe("劣勢");
  });

  it("uses tighter battle labels when the pair has enough matches", () => {
    expect(headToHeadToneLabel(0.601563, 128)).toBe("優勢");
    expect(headToHeadToneLabel(0.554688, 128)).toBe("やや優勢");
    expect(headToHeadToneLabel(0.515625, 128)).toBe("互角");
    expect(headToHeadToneLabel(0.445313, 128)).toBe("やや劣勢");
    expect(headToHeadToneLabel(0.398438, 128)).toBe("劣勢");
  });

  it("uses average rank diff when a mature pair rate is near even", () => {
    expect(headToHeadToneLabel(0.484375, 128, -0.1875)).toBe("やや劣勢");
    expect(headToHeadToneLabel(0.515625, 128, 0.1875)).toBe("やや優勢");
    expect(headToHeadToneLabel(0.515625, 128, 0.078125)).toBe("互角");
  });

  it("falls back labels by match count", () => {
    expect(headToHeadToneLabel(0.8, 2)).toBe("参考");
    expect(headToHeadToneLabel(0.5, 0)).toBe("判定なし");
    expect(headToHeadToneLabel(null, 0)).toBe("判定なし");
  });
});

describe("headToHeadCellTone", () => {
  it("uses neutral styling in the 0.45-0.55 band", () => {
    expect(headToHeadCellTone(0.5).color).toBe("var(--color-tray-incident)");
    expect(headToHeadCellTone(0.46).alpha).toBeLessThan(0.2);
    expect(headToHeadCellTone(0.46).color).toBe("var(--color-tray-incident)");
    expect(headToHeadCellTone(0.515625, 128).color).toBe("var(--color-tray-incident)");
    expect(headToHeadCellTone(1, 2).color).toBe("var(--color-tray-incident)");
  });

  it("uses directional styling outside neutral band", () => {
    expect(headToHeadCellTone(0.55).color).toBe("var(--color-action)");
    expect(headToHeadCellTone(0.65).color).toBe("var(--color-action)");
    expect(headToHeadCellTone(0.554688, 128).color).toBe("var(--color-action)");
    expect(headToHeadCellTone(0.45).color).toBe("var(--color-danger)");
    expect(headToHeadCellTone(0.35).color).toBe("var(--color-danger)");
    expect(headToHeadCellTone(0.445313, 128).color).toBe("var(--color-danger)");
    expect(headToHeadCellTone(0.484375, 128, -0.1875).color).toBe("var(--color-danger)");
    expect(headToHeadCellTone(0.515625, 128, 0.1875).color).toBe("var(--color-action)");
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
