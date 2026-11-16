import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ExpectedRankGapEvidence } from "@/features/seriesComparison/drilldowns/SeriesAnalysisExpectedRankGapEvidence";
import { makeSeriesAnalysisDrilldown } from "@/test/msw/seriesAnalysisFixtures";

function evidencePayload() {
  const response = makeSeriesAnalysisDrilldown("expectedRankGap.evidence");
  if (response.payload.kind !== "expected_rank_gap_evidence") throw new Error("unexpected fixture");
  return response.payload;
}

describe("expected-rank gap evidence", () => {
  it("lists both sides in artifact order with the saved note only where one exists", async () => {
    const user = userEvent.setup();
    const onFocusMatch = vi.fn();
    render(
      <MemoryRouter>
        <ExpectedRankGapEvidence
          payload={evidencePayload()}
          playerName="ぽんた"
          onFocusMatch={onFocusMatch}
        />
      </MemoryRouter>,
    );

    const above = screen.getByRole("region", { name: "見込みより上位だった試合" });
    const items = within(above).getAllByRole("listitem");
    expect(items.map((item) => within(item).getByRole("link").textContent)).toEqual([
      "第12戦",
      "第7戦",
    ]);
    expect(items[0]).toHaveTextContent(/実際 1位見込み 2.50位・＋1.50位/u);
    expect(items[0]).toHaveTextContent(/試合メモ売り場で現金を作って逃げ切った/u);
    expect(items[1]).not.toHaveTextContent("試合メモ");
    expect(
      within(items[0] as HTMLElement).getByRole("link", { name: "第12戦の試合結果を開く" }),
    ).toHaveAttribute("href", "/matches/match-12");

    await user.click(
      within(items[0] as HTMLElement).getByRole("button", { name: "第12戦をこのページで比較する" }),
    );
    expect(onFocusMatch).toHaveBeenCalledWith("match-12");
  });

  it("reads an empty side as not applicable instead of filling it with smaller gaps", () => {
    const payload = evidencePayload();
    render(
      <MemoryRouter>
        <ExpectedRankGapEvidence
          payload={{ ...payload, below: [], summary: { ...payload.summary, belowCount: 0 } }}
          playerName="ぽんた"
        />
      </MemoryRouter>,
    );
    const below = screen.getByRole("region", { name: "見込みより下位だった試合" });
    expect(below).toHaveTextContent("該当なし");
    expect(within(below).queryByRole("listitem")).not.toBeInTheDocument();
  });
});
