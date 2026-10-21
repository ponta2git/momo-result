import { describe, expect, it } from "vitest";

import {
  heldEventDetailHref,
  isPublicId,
  matchDetailHref,
} from "@/shared/navigation/publicIdentifiers";

describe("public identifier links", () => {
  it("keeps bigint values exact and never interprets a numeric legacy identity as public", () => {
    expect(matchDetailHref("1")).toBe("/matches/1");
    expect(heldEventDetailHref("1")).toBe("/held-events/1");
    expect(matchDetailHref("legacy", "9007199254740993")).toBe("/m/9007199254740993");
    expect(heldEventDetailHref("legacy", "9223372036854775807")).toBe("/e/9223372036854775807");
    expect(matchDetailHref(" 1/A ", "01")).toBe("/matches/%201%2FA%20");
  });

  it.each(["0", "01", "+1", " 1", "1e3", "9223372036854775808", 1, null])(
    "does not generate a public link from an invalid value (%j)",
    (value) => expect(isPublicId(value)).toBe(false),
  );
});
