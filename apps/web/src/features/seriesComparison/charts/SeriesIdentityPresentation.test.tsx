import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CrownShareBars } from "@/features/seriesComparison/charts/SeriesAnalysisOverviewCharts";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";

const reversedCanonicalPlayers = [
  { displayName: "おーたか", memberId: "member_otaka" },
  { displayName: "あかねまみ", memberId: "member_akane_mami" },
  { displayName: "ぽんた", memberId: "member_ponta" },
  { displayName: "いーゆー", memberId: "member_eu" },
];

function legendColors(container: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    [...container.querySelectorAll("dl > div")].map((row) => [
      row.querySelector("dt")?.textContent ?? "",
      (row as HTMLElement).style.borderLeftColor,
    ]),
  );
}

describe("series chart identity", () => {
  it("keeps each color stable and renders canonical DOM order when the API order is reversed", () => {
    const response = makeSeriesAnalysisAggregate();
    const first = render(
      <CrownShareBars response={{ ...response, players: reversedCanonicalPlayers.toReversed() }} />,
    );
    const before = legendColors(first.container);
    first.unmount();

    const second = render(
      <CrownShareBars response={{ ...response, players: reversedCanonicalPlayers }} />,
    );

    expect(legendColors(second.container)).toEqual(before);
    expect([...second.container.querySelectorAll("dl dt")].map((item) => item.textContent)).toEqual(
      ["いーゆー", "ぽんた", "あかねまみ", "おーたか"],
    );
  });
});
