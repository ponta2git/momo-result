import { describe, expect, it } from "vitest";

import {
  rankSignalCandidateShares,
  rankSignalPriorityLabel,
} from "@/features/seriesComparison/model/seriesComparisonRankAnalysis";

describe("series comparison rank signal presentation", () => {
  it("turns candidate importance into deterministic shares totaling 100 percent", () => {
    expect(rankSignalCandidateShares([{ importance: 0.071 }, { importance: 0.0182 }])).toEqual([
      80, 20,
    ]);
    expect(
      rankSignalCandidateShares([{ importance: 1 }, { importance: 1 }, { importance: 1 }]),
    ).toEqual([34, 33, 33]);
  });

  it("does not invent a share when every importance is unusable", () => {
    expect(rankSignalCandidateShares([{ importance: 0 }, { importance: Number.NaN }])).toEqual([
      0, 0,
    ]);
  });

  it("names one candidate without implying that 100 percent is absolute strength", () => {
    expect(rankSignalPriorityLabel(0, 1)).toBe("この1件");
    expect(rankSignalPriorityLabel(0, 3)).toBe("第一候補");
    expect(rankSignalPriorityLabel(1, 3)).toBe("第二候補");
    expect(rankSignalPriorityLabel(2, 3)).toBe("補助候補");
  });
});
