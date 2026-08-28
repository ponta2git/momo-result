import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DataVizLegend,
  dataVizSeriesPresentation,
  playOrderSeriesId,
} from "@/shared/ui/dataViz/seriesPresentation";

const memberIds = ["member_eu", "member_ponta", "member_akane_mami", "member_otaka"];

describe("dataVizSeriesPresentation", () => {
  it("keeps color, dash, and shape attached to a stable ID when input order changes", () => {
    const before = Object.fromEntries(
      memberIds.map((memberId) => [memberId, dataVizSeriesPresentation(memberId)]),
    );
    const after = Object.fromEntries(
      memberIds.toReversed().map((memberId) => [memberId, dataVizSeriesPresentation(memberId)]),
    );

    expect(after).toEqual(before);
    expect(new Set(Object.values(before).map(({ color }) => color)).size).toBe(4);
    expect(
      Object.values(before).every(({ color }) => color.includes("--color-member-sequence-")),
    ).toBe(true);
  });

  it("renders the same non-color line signifiers after legend reordering", () => {
    const identities = memberIds.map((id) => ({ id, label: id }));
    const first = render(<DataVizLegend series={identities} variant="line" />);
    const firstMarks = Object.fromEntries(
      [...first.container.querySelectorAll<SVGElement>("[data-series-id]")].map((mark) => [
        mark.dataset["seriesId"],
        mark.dataset["seriesShape"],
      ]),
    );
    first.unmount();

    const second = render(<DataVizLegend series={identities.toReversed()} variant="line" />);
    const secondMarks = Object.fromEntries(
      [...second.container.querySelectorAll<SVGElement>("[data-series-id]")].map((mark) => [
        mark.dataset["seriesId"],
        mark.dataset["seriesShape"],
      ]),
    );

    expect(secondMarks).toEqual(firstMarks);
    expect(new Set(Object.values(firstMarks)).size).toBe(4);
  });

  it("keeps play-order series on the same hues through a separate semantic role", () => {
    expect(dataVizSeriesPresentation(playOrderSeriesId(2)).color).toBe("var(--color-play-order-2)");
    expect(dataVizSeriesPresentation("unrelated-series").color).toContain("--color-series-");
  });
});
