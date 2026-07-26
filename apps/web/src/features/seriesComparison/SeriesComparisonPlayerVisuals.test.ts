// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  playerColor,
  playerDashPattern,
  playerGridStyle,
  playerPointShape,
} from "./charts/SeriesComparisonPlayerVisuals";

describe("SeriesComparisonPlayerVisuals", () => {
  it("cycles through the player palette", () => {
    expect(playerColor(0)).toBe("var(--color-player-1)");
    expect(playerColor(6)).toBe("var(--color-player-1)");
  });

  it("keeps the player grid count positive", () => {
    expect(playerGridStyle(0)).toEqual({ "--player-count": "1" });
    expect(playerGridStyle(4)).toEqual({ "--player-count": "4" });
  });

  it("gives each of the four players a non-color line and point treatment", () => {
    expect([0, 1, 2, 3].map(playerDashPattern)).toEqual([undefined, "7 3", "2 3", "9 3 2 3"]);
    expect([0, 1, 2, 3].map(playerPointShape)).toEqual(["circle", "square", "diamond", "triangle"]);
  });
});
