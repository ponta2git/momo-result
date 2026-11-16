import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ExpectedRankGapSection } from "@/features/seriesComparison/page/SeriesAnalysisExpectedRankGapSection";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";

function renderSection(response = makeSeriesAnalysisAggregate()) {
  const onDrilldown = vi.fn();
  function Harness() {
    const [memberId, setMemberId] = useState<string>();
    return (
      <ExpectedRankGapSection
        gap={response.expectedRankGap}
        players={response.players}
        memberId={memberId}
        onMemberChange={setMemberId}
        onDrilldown={onDrilldown}
      />
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return { onDrilldown };
}

function rowNamed(table: HTMLElement, name: RegExp) {
  const header = within(table).getByRole("rowheader", { name });
  const row = header.closest('[role="row"]');
  if (!(row instanceof HTMLElement)) throw new Error("row is missing");
  return row;
}

describe("expected-rank gap section", () => {
  it("reads each player's expected and actual rank with the judged direction", async () => {
    const user = userEvent.setup();
    const { onDrilldown } = renderSection();

    const players = screen.getByRole("table", { name: "4人の見込みとの差" });
    const ponta = rowNamed(players, /ぽんた/u);
    expect(
      within(ponta)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(
      expect.arrayContaining([
        "12戦",
        expect.stringContaining("2.50位"),
        expect.stringContaining("2.65位"),
        "−0.15位",
        expect.stringMatching(/^見込みより下位、傾向あり/u),
      ]),
    );

    await user.click(within(ponta).getByRole("button", { name: "ぽんたの根拠の試合を見る" }));
    expect(onDrilldown).toHaveBeenCalledWith({
      memberId: "member_ponta",
      metricId: "expectedRankGap.evidence",
    });
  });

  it("keys the band once and names the axis sides instead of repeating directions", () => {
    renderSection();
    expect(screen.getAllByText("差がなくても偶然で動く範囲")).toHaveLength(1);
    expect(screen.queryByText("場全体の値")).not.toBeInTheDocument();
    const players = screen.getByRole("table", { name: "4人の見込みとの差" });
    const header = within(players).getAllByRole("columnheader")[4];
    expect(header).toHaveTextContent(/← 見込みより下位見込みより上位 →/u);
  });

  it("switches the record table to one player without moving the reading position", async () => {
    const user = userEvent.setup();
    renderSection();

    const overall = screen.getByRole("table", { name: "記録別の見込みとの差（場全体）" });
    expect(screen.getByText("0回は見込みより下位、2回以上は上位の傾向")).toBeInTheDocument();
    expect(
      within(overall).getByRole("button", { name: /背景: 物件収益のシェアに差は見られない/u }),
    ).toBeInTheDocument();
    expect(rowNamed(overall, /カード売り場 0回/u)).toHaveTextContent(/20件.*42%/u);

    const subject = screen.getByRole("radio", { name: "ぽんた" });
    await user.click(subject);

    const mine = screen.getByRole("table", { name: "記録別の見込みとの差（ぽんた）" });
    const shopNone = rowNamed(mine, /カード売り場 0回/u);
    expect(shopNone).toHaveTextContent(/6戦.*50%/u);
    expect(shopNone).toHaveTextContent("2.90位");
    expect(shopNone).toHaveTextContent(/見込みより下位、兆し/u);
    // A one- or two-result level keeps its values as a reference without a word.
    expect(rowNamed(mine, /カード売り場 2回以上/u)).toHaveTextContent(/2戦.*参考値/u);
    expect(
      screen.getByText("場全体: 0回は見込みより下位、2回以上は上位の傾向"),
    ).toBeInTheDocument();
    expect(within(mine).queryByRole("button", { name: /背景:/u })).not.toBeInTheDocument();
    expect(screen.getByText("場全体の値")).toBeInTheDocument();
    expect(subject).toHaveFocus();
    expect(subject).toBeChecked();
  });

  it("shows no table before a scope has three matches", () => {
    const response = makeSeriesAnalysisAggregate();
    renderSection({
      ...response,
      expectedRankGap: {
        ...response.expectedRankGap,
        items: [],
        layers: [],
        matchCount: 2,
        players: [],
        reasonCodes: ["insufficient_matches"],
        status: "no_target",
      },
    });
    expect(screen.getByText("対象なし")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
