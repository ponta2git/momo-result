import { describe, expect, it } from "vitest";

import { parseLayoutFamily } from "@/shared/domain/ocr";

import layoutFixture from "../../../../../docs/schemas/fixtures/ocr-worker/layout-families-v1.json";

describe("layout family contract", () => {
  it.each(layoutFixture.accepted)("resolves $input as $canonical", ({ input, canonical }) => {
    expect(parseLayoutFamily(input)).toBe(canonical);
  });

  it.each(layoutFixture.rejected)("rejects unsupported %j", (input) => {
    expect(parseLayoutFamily(input)).toBeUndefined();
  });

  it("keeps absent hints distinct from an explicit world layout", () => {
    expect(parseLayoutFamily(undefined)).toBeUndefined();
    expect(parseLayoutFamily(null)).toBeUndefined();
    expect(parseLayoutFamily("default")).toBe("world");
  });
});
