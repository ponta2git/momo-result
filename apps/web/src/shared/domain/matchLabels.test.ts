// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatMatchNoInEvent, formatSeriesMatchIndex } from "@/shared/domain/matchLabels";

const invalidOrdinals = [
  undefined,
  null,
  0,
  -1,
  1.5,
  Number.NaN,
  Infinity,
  -Infinity,
  Number.MAX_SAFE_INTEGER + 1,
] as const;

describe("match label formatters", () => {
  it("keeps the held-event match number and comparison index vocabularies distinct", () => {
    expect(formatMatchNoInEvent(12)).toBe("第12試合");
    expect(formatSeriesMatchIndex(12)).toBe("第12戦");
  });

  it.each(invalidOrdinals)("does not invent a held-event match number for %s", (value) => {
    expect(formatMatchNoInEvent(value)).toBe("試合番号未設定");
  });

  it.each(invalidOrdinals)("does not invent a comparison index for %s", (value) => {
    expect(formatSeriesMatchIndex(value)).toBe("対戦順未設定");
  });

  it("uses a caller-owned fallback when the surrounding workflow has a more precise state", () => {
    expect(formatMatchNoInEvent(undefined, "確定時に設定")).toBe("確定時に設定");
  });
});
