// @vitest-environment node

import { describe, expect, it } from "vitest";

import { normalizeOutlookPair } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { canonicalResultMemberIds } from "@/shared/domain/members";

const [first, second, third] = canonicalResultMemberIds;

describe("outlook pair defaults", () => {
  it("starts from the signed-in player, then the first other fixed member", () => {
    expect(normalizeOutlookPair(undefined, undefined, third)).toEqual({
      focusMemberId: third,
      rivalMemberId: first,
    });
    expect(normalizeOutlookPair(undefined, undefined, first)).toEqual({
      focusMemberId: first,
      rivalMemberId: second,
    });
  });

  it("keeps a requested person and only fills what is missing", () => {
    expect(normalizeOutlookPair(second, undefined, third)).toEqual({
      focusMemberId: second,
      rivalMemberId: first,
    });
    expect(normalizeOutlookPair(undefined, second, third)).toEqual({
      focusMemberId: third,
      rivalMemberId: second,
    });
    // The signed-in player is already the requested rival, so the focus falls back.
    expect(normalizeOutlookPair(undefined, third, third)).toEqual({
      focusMemberId: first,
      rivalMemberId: third,
    });
  });

  it("uses the canonical start for an account that is not a player", () => {
    expect(normalizeOutlookPair(undefined, undefined, undefined)).toEqual({
      focusMemberId: first,
      rivalMemberId: second,
    });
    expect(normalizeOutlookPair(undefined, undefined, "member_unknown")).toEqual({
      focusMemberId: first,
      rivalMemberId: second,
    });
  });
});
