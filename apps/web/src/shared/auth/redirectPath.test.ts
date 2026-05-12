import { describe, expect, it } from "vitest";

import {
  buildAuthLoginHref,
  buildLoginPath,
  currentAppPath,
  sanitizeAppRedirectPath,
} from "@/shared/auth/redirectPath";

describe("redirectPath", () => {
  it("preserves internal app paths with search and hash", () => {
    expect(currentAppPath("/exports", "?format=tsv", "#latest")).toBe("/exports?format=tsv#latest");
    expect(sanitizeAppRedirectPath("/exports?format=tsv#latest")).toBe(
      "/exports?format=tsv#latest",
    );
  });

  it("rejects protocol-relative and external redirect targets", () => {
    expect(sanitizeAppRedirectPath("//example.com/login")).toBeUndefined();
    expect(sanitizeAppRedirectPath("https://example.com/login")).toBeUndefined();
    expect(sanitizeAppRedirectPath("exports")).toBeUndefined();
  });

  it("builds login paths only with sanitized next values", () => {
    expect(buildLoginPath("/exports?format=tsv")).toBe("/login?next=%2Fexports%3Fformat%3Dtsv");
    expect(buildLoginPath("//example.com/login")).toBe("/login");
    expect(buildAuthLoginHref("/matches/match-1/edit")).toBe(
      "/api/auth/login?next=%2Fmatches%2Fmatch-1%2Fedit&silent=1",
    );
    expect(buildAuthLoginHref("https://example.com/login")).toBe("/api/auth/login?silent=1");
  });
});
