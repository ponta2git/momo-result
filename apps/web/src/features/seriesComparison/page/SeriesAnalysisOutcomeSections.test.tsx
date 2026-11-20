import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DestinationOutcomeSection } from "@/features/seriesComparison/page/SeriesAnalysisOutcomeSections";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";

function detailValue(list: HTMLElement, label: string) {
  return within(list).getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
}

describe("destination outcome section", () => {
  it("reads both destination differences on the rank scale with their direction", async () => {
    const user = userEvent.setup();
    const response = makeSeriesAnalysisAggregate();
    render(<DestinationOutcomeSection response={response} />);
    const [metric] = response.metricsByPlayer;
    const [disclosure] = screen.getAllByRole("button", { name: "目的地と順位の詳細" });
    if (!metric || !disclosure) throw new Error("fixture player is missing");

    await user.click(disclosure);
    const list = screen.getByLabelText(`${metric.displayName}の目的地と順位の詳細`);
    expect(detailValue(list, "目的地順位と最終順位の差")).toBe("0.2位");
    expect(detailValue(list, "目的地への依存度")).toBe("到着上位の試合が0.3位上");
  });
});
