// @vitest-environment node
import { describe, expect, it } from "vitest";

import { bySlot, forEachSlot, mapSlots, slotEntries } from "@/shared/lib/slotMap";

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

  it("maps present values without mutating the source map", () => {
    const source = bySlot([
      ["total_assets", 10],
      ["incident_log", 30],
    ]);

    const mapped = mapSlots(source, (value, kind) => `${kind}:${value * 2}`);

    expect(mapped).toEqual({
      incident_log: "incident_log:60",
      total_assets: "total_assets:20",
    });
    expect(source).toEqual({ incident_log: 30, total_assets: 10 });
  });

  it("iterates entries in canonical slot order", () => {
    const source = bySlot([
      ["incident_log", "incidents"],
      ["total_assets", "assets"],
      ["revenue", "revenue"],
    ]);
    const seen: string[] = [];

    forEachSlot(source, (value, kind) => seen.push(`${kind}:${value}`));

    expect(seen).toEqual(["total_assets:assets", "revenue:revenue", "incident_log:incidents"]);
    expect(slotEntries(source)).toEqual([
      ["total_assets", "assets"],
      ["revenue", "revenue"],
      ["incident_log", "incidents"],
    ]);
  });

  it("skips absent slots during ordered iteration", () => {
    const source = bySlot([
      ["incident_log", "incidents"],
      ["total_assets", "assets"],
    ]);
    const seen: string[] = [];

    forEachSlot(source, (value, kind) => seen.push(`${kind}:${value}`));

    expect(seen).toEqual(["total_assets:assets", "incident_log:incidents"]);
    expect(slotEntries(source)).toEqual([
      ["total_assets", "assets"],
      ["incident_log", "incidents"],
    ]);
  });
});
