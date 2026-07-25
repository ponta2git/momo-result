// @vitest-environment node
import { describe, expect, it } from "vitest";

import { bySlot } from "@/shared/lib/slotMap";

describe("slotMap", () => {
  it("builds partial maps without nullish values", () => {
    expect(
      bySlot([
        ["total_assets", "assets"],
        ["revenue", undefined],
        ["incident_log", null],
      ]),
    ).toEqual({ total_assets: "assets" });
  });
});
