import { within } from "@testing-library/dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MatchNoInEventMatrix } from "@/features/seriesComparison/charts/SeriesAnalysisMatchNoMatrix";
import { CrownShareBars } from "@/features/seriesComparison/charts/SeriesAnalysisOverviewCharts";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";

const reversedCanonicalPlayers = [
  { displayName: "おーたか", memberId: "member_otaka" },
  { displayName: "あかねまみ", memberId: "member_akane_mami" },
  { displayName: "ぽんた", memberId: "member_ponta" },
  { displayName: "いーゆー", memberId: "member_eu" },
];

describe("series artifact presentation", () => {
  it("preserves the player order supplied by the artifact", () => {
    const response = makeSeriesAnalysisAggregate();
    render(<CrownShareBars response={{ ...response, players: reversedCanonicalPlayers }} />);

    expect(screen.getAllByRole("term").map((item) => item.textContent)).toEqual([
      "おーたか",
      "あかねまみ",
      "ぽんた",
      "いーゆー",
    ]);
    const crownShareBar = screen.getByRole("img", {
      name: /平均順位首位に残った比率/u,
    });
    const crownShareSegments = crownShareBar.children;
    expect(crownShareSegments[0]).not.toHaveStyle({
      boxShadow: "inset 1px 0 var(--color-chart-segment-separator)",
    });
    expect(crownShareSegments[1]).toHaveStyle({
      boxShadow: "inset 1px 0 var(--color-chart-segment-separator)",
    });
  });

  it("uses the artifact category instead of inferring it from the match number", async () => {
    const user = userEvent.setup();
    const response = makeSeriesAnalysisAggregate();
    const [sourceEntry] = response.matchNoInEvent.entries;
    if (!sourceEntry) throw new Error("match-number fixture is missing");
    response.matchNoInEvent.entries = [
      { ...sourceEntry, category: "regular", matchNoInEvent: 5 },
      { ...sourceEntry, category: "additional", matchNoInEvent: 2 },
    ];

    render(<MatchNoInEventMatrix response={response} />);

    const regular = screen.getByRole("table", { name: "通常試合の開催内順別傾向" });
    expect(within(regular).getByText("第5試合")).toBeInTheDocument();
    expect(within(regular).queryByText("第2試合")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "追加試合" }));
    const additional = screen.getByRole("table", { name: "追加試合の開催内順別傾向" });
    expect(within(additional).getByText("第2試合")).toBeInTheDocument();
  });

  it("does not synthesize a zero-valued player row omitted by the artifact", () => {
    const response = makeSeriesAnalysisAggregate();
    const [sourceEntry] = response.matchNoInEvent.entries;
    if (!sourceEntry) throw new Error("match-number fixture is missing");
    response.players = [{ displayName: "いーゆー", memberId: "member_eu" }, ...response.players];

    render(<MatchNoInEventMatrix response={response} />);

    const regular = screen.getByRole("table", { name: "通常試合の開催内順別傾向" });
    expect(within(regular).getAllByRole("cell")).toHaveLength(sourceEntry.players.length);
    expect(within(regular).queryByLabelText(/いーゆー、第1試合/u)).not.toBeInTheDocument();
  });
});
