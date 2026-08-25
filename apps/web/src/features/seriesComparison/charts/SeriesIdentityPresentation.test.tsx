import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CrownShareBars } from "@/features/seriesComparison/charts/SeriesAnalysisOverviewCharts";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";

function legendColors(container: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    [...container.querySelectorAll("dl > div")].map((row) => [
      row.querySelector("dt")?.textContent ?? "",
      (row as HTMLElement).style.borderLeftColor,
    ]),
  );
}

describe("series chart identity", () => {
  it("keeps each member color stable when the API player order changes", () => {
    const response = makeSeriesAnalysisAggregate();
    const first = render(<CrownShareBars response={response} />);
    const before = legendColors(first.container);
    first.unmount();

    const second = render(
      <CrownShareBars response={{ ...response, players: response.players.toReversed() }} />,
    );

    expect(legendColors(second.container)).toEqual(before);
  });
});
