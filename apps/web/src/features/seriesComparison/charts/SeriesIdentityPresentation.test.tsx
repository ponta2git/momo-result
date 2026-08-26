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

function legendPresentations(
  container: HTMLElement,
): Record<string, { color: string | undefined; sequence: string | undefined }> {
  return Object.fromEntries(
    [...container.querySelectorAll("dl > div")].map((row) => {
      const label = row.querySelector<HTMLElement>("[data-member-sequence]");
      return [
        row.querySelector("dt")?.textContent ?? "",
        {
          color: label?.querySelector<HTMLElement>("[aria-hidden='true']")?.style.backgroundColor,
          sequence: label?.dataset["memberSequence"],
        },
      ];
    }),
  );
}

describe("series chart identity", () => {
  it("keeps each color stable and renders canonical DOM order when the API order is reversed", () => {
    const response = makeSeriesAnalysisAggregate();
    const first = render(
      <CrownShareBars response={{ ...response, players: reversedCanonicalPlayers.toReversed() }} />,
    );
    const before = legendPresentations(first.container);
    first.unmount();

    const second = render(
      <CrownShareBars response={{ ...response, players: reversedCanonicalPlayers }} />,
    );

    expect(legendPresentations(second.container)).toEqual(before);
    expect(legendPresentations(second.container)).toEqual({
      いーゆー: { color: "var(--color-member-sequence-1)", sequence: "1" },
      ぽんた: { color: "var(--color-member-sequence-2)", sequence: "2" },
      あかねまみ: { color: "var(--color-member-sequence-3)", sequence: "3" },
      おーたか: { color: "var(--color-member-sequence-4)", sequence: "4" },
    });
    expect([...second.container.querySelectorAll("dl dt")].map((item) => item.textContent)).toEqual(
      ["いーゆー", "ぽんた", "あかねまみ", "おーたか"],
    );
  });
});
