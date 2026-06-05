// @vitest-environment node
import { describe, expect, it } from "vitest";

import { assertDefined } from "@/shared/lib/invariant";

describe("assertDefined", () => {
  it("keeps a defined value available to the caller", () => {
    function uppercaseMatchId(value: string | undefined): string {
      assertDefined(value, "matchId");
      return value.toUpperCase();
    }

    expect(uppercaseMatchId("match-1")).toBe("MATCH-1");
  });

  it.each([null, undefined])("throws a named invariant error for %s", (value) => {
    expect(() => assertDefined(value, "matchId")).toThrow('Expected "matchId" to be defined.');
  });
});
