import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CrownShareBars } from "@/features/seriesComparison/charts/SeriesAnalysisOverviewCharts";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";

const reversedCanonicalPlayers = [
  { displayName: "おーたか", memberId: "member_otaka" },
  { displayName: "あかねまみ", memberId: "member_akane_mami" },
  { displayName: "ぽんた", memberId: "member_ponta" },
  { displayName: "いーゆー", memberId: "member_eu" },
];

describe("series chart identity", () => {
  it("renders a canonical legend order when the API order is reversed", () => {
    const response = makeSeriesAnalysisAggregate();
    render(<CrownShareBars response={{ ...response, players: reversedCanonicalPlayers }} />);

    expect(screen.getAllByRole("term").map((item) => item.textContent)).toEqual([
      "いーゆー",
      "ぽんた",
      "あかねまみ",
      "おーたか",
    ]);
  });
});
