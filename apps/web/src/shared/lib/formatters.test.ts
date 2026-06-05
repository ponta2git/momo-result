// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatManYen } from "@/shared/lib/formatters";

describe("formatManYen", () => {
  it.each([
    { expected: "0万円", value: 0 },
    { expected: "9999万円", value: 9999 },
    { expected: "1億円", value: 10_000 },
    { expected: "1億0001万円", value: 10_001 },
    { expected: "-1億0001万円", value: -10_001 },
  ])("formats $value as $expected", ({ expected, value }) => {
    expect(formatManYen(value)).toBe(expected);
  });
});
