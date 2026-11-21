// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  layoutEndLabels,
  placeInlineLabel,
} from "@/features/seriesComparison/outlook/workspace/chart/chartLabels";

describe("chart labels", () => {
  it("pushes end labels apart in anchor order and keeps them inside the plot", () => {
    const placed = layoutEndLabels(
      [
        { id: "c", anchorY: 100 },
        { id: "a", anchorY: 98 },
        { id: "b", anchorY: 99 },
      ],
      { gap: 14, top: 10, bottom: 120 },
    );
    expect(placed.map((label) => [label.id, label.y])).toEqual([
      ["a", 92],
      ["b", 106],
      ["c", 120],
    ]);
    expect(
      layoutEndLabels([{ anchorY: 2 }, { anchorY: 3 }], { gap: 14, top: 10, bottom: 120 }).map(
        (label) => label.y,
      ),
    ).toEqual([10, 24]);
  });

  it("chooses the first candidate that clears every obstacle inside the bounds", () => {
    const bounds = { x0: 0, x1: 100, y0: 0, y1: 100 };
    expect(
      placeInlineLabel(
        [
          { x0: 90, x1: 120, y0: 10, y1: 20 },
          { x0: 10, x1: 40, y0: 45, y1: 55 },
          { x0: 10, x1: 40, y0: 70, y1: 80 },
        ],
        [{ x0: 0, x1: 100, y0: 48, y1: 52 }],
        bounds,
      ),
    ).toEqual({ x0: 10, x1: 40, y0: 70, y1: 80 });
    expect(placeInlineLabel([{ x0: 10, x1: 40, y0: 45, y1: 55 }], [bounds], bounds)).toBeNull();
  });
});
