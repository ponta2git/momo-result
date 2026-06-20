// @vitest-environment node
import { describe, expect, it } from "vitest";

import { playerColor, playerGridStyle } from "./SeriesComparisonPlayerVisuals";

describe("SeriesComparisonPlayerVisuals", () => {
  it("cycles through the player palette", () => {
    expect(playerColor(0)).toBe("var(--color-player-1)");
    expect(playerColor(6)).toBe("var(--color-player-1)");
  });

  it("keeps the player grid count positive", () => {
    expect(playerGridStyle(0)).toEqual({ "--player-count": "1" });
    expect(playerGridStyle(4)).toEqual({ "--player-count": "4" });
  });
});
