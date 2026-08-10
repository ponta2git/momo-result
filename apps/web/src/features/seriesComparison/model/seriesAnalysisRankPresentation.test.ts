import { describe, expect, it } from "vitest";

import { rankSignalCandidateShareLabel } from "@/features/seriesComparison/model/seriesAnalysisRankPresentation";

describe("rankSignalCandidateShareLabel", () => {
  it("does not present a sole candidate as a 100 percent probability", () => {
    expect(rankSignalCandidateShareLabel(100, 1)).toBe("候補はこの1件");
  });

  it("formats a share only when candidates can be compared", () => {
    expect(rankSignalCandidateShareLabel(62.5, 2)).toBe("62.5%");
    expect(rankSignalCandidateShareLabel(null, 2)).toBe("—");
  });
});
