import { describe, expect, it } from "vitest";

import { headToHeadCellTone, headToHeadToneLabel } from "./SeriesComparisonCharts";

describe("headToHeadToneLabel", () => {
  it("uses battle significance thresholds", () => {
    expect(headToHeadToneLabel(0.8, 3)).toBe("優勢");
    expect(headToHeadToneLabel(0.65, 3)).toBe("優勢");
    expect(headToHeadToneLabel(0.55, 3)).toBe("やや優勢");
    expect(headToHeadToneLabel(0.5, 3)).toBe("互角");
    expect(headToHeadToneLabel(0.45, 3)).toBe("やや劣勢");
    expect(headToHeadToneLabel(0.35, 3)).toBe("劣勢");
  });

  it("falls back labels by match count", () => {
    expect(headToHeadToneLabel(0.8, 2)).toBe("参考");
    expect(headToHeadToneLabel(0.5, 0)).toBe("判定なし");
    expect(headToHeadToneLabel(null, 0)).toBe("判定なし");
  });
});

describe("headToHeadCellTone", () => {
  it("uses neutral styling in the 0.45-0.55 band", () => {
    expect(headToHeadCellTone(0.5).rgb).toBe("108, 117, 125");
    expect(headToHeadCellTone(0.46).alpha).toBeLessThan(0.2);
    expect(headToHeadCellTone(0.46).rgb).toBe("108, 117, 125");
    expect(headToHeadCellTone(1, 2).rgb).toBe("108, 117, 125");
  });

  it("uses directional styling outside neutral band", () => {
    expect(headToHeadCellTone(0.55).rgb).toBe("37, 99, 235");
    expect(headToHeadCellTone(0.65).rgb).toBe("37, 99, 235");
    expect(headToHeadCellTone(0.45).rgb).toBe("220, 38, 38");
    expect(headToHeadCellTone(0.35).rgb).toBe("220, 38, 38");
  });
});
