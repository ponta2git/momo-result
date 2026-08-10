// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatManYen } from "@/shared/lib/formatters";

describe("formatManYen", () => {
  it.each([
    { expected: "0万円", value: 0 },
    { expected: "9999万円", value: 9999 },
    { expected: "1億円", value: 10_000 },
    { expected: "1億0001万円", value: 10_001 },
    { expected: "1兆円", value: 100_000_000 },
    { expected: "1兆1万円", value: 100_000_001 },
    { expected: "1兆2億0003万円", value: 100_020_003 },
    { expected: "-1億0001万円", value: -10_001 },
    { expected: "-2兆3億円", value: -200_030_000 },
    { expected: "2万円", value: 1.6 },
    { expected: "0万円", value: -0.4 },
  ])("formats $value as $expected", ({ expected, value }) => {
    expect(formatManYen(value)).toBe(expected);
  });
});
