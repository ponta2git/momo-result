import { describe, expect, it } from "vitest";

import {
  currentInternalLocation,
  sanitizeReturnTo,
  withReturnTo,
} from "@/shared/navigation/returnTo";

describe("internal return navigation", () => {
  it("preserves a complete internal path in a child route", () => {
    const returnTo = currentInternalLocation({
      hash: "#results",
      pathname: "/matches",
      search: "?status=confirmed&page=3",
    });
    expect(withReturnTo("/matches/match-1", returnTo)).toBe(
      "/matches/match-1?returnTo=%2Fmatches%3Fstatus%3Dconfirmed%26page%3D3%23results",
    );
  });

  it("rejects protocol-relative and external destinations", () => {
    expect(sanitizeReturnTo("//evil.example/path")).toBeUndefined();
    expect(sanitizeReturnTo("https://evil.example/path")).toBeUndefined();
    expect(withReturnTo("/matches/match-1", "https://evil.example/path")).toBe("/matches/match-1");
  });
});
