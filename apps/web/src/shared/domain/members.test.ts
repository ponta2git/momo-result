// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  canonicalResultMemberIds,
  defaultOwnerMemberId,
  fixedMemberIds,
  fixedMemberRegistry,
  fixedMembers,
  isFixedMemberId,
  memberDisplayName,
  orderFixedMembers,
  workspaceInputMemberIds,
} from "@/shared/domain/members";

describe("fixed member contracts", () => {
  it("keeps identity, accepted IDs, workspace slots, result display, and owner as separate contracts", () => {
    expect(
      fixedMemberIds.every((memberId) => fixedMemberRegistry[memberId].memberId === memberId),
    ).toBe(true);
    expect(new Set(workspaceInputMemberIds)).toEqual(new Set(fixedMemberIds));
    expect(new Set(canonicalResultMemberIds)).toEqual(new Set(fixedMemberIds));

    expect(workspaceInputMemberIds).toEqual([
      "member_ponta",
      "member_akane_mami",
      "member_otaka",
      "member_eu",
    ]);
    expect(canonicalResultMemberIds).toEqual([
      "member_eu",
      "member_ponta",
      "member_akane_mami",
      "member_otaka",
    ]);
    expect(defaultOwnerMemberId).toBe("member_ponta");
    expect(fixedMembers.map((member) => member.memberId)).toEqual(workspaceInputMemberIds);
  });

  it("orders known members canonically and moves unknown IDs behind them without losing stability", () => {
    const input = [
      { memberId: "future-z", marker: "unknown-first" },
      { memberId: "member_otaka", marker: "otaka" },
      { memberId: "member_ponta", marker: "ponta-first" },
      { memberId: "future-a", marker: "unknown-second" },
      { memberId: "member_eu", marker: "eu" },
      { memberId: "member_akane_mami", marker: "akane" },
      { memberId: "member_ponta", marker: "ponta-second" },
    ] as const;

    const ordered = orderFixedMembers(input);

    expect(ordered.map((value) => value.marker)).toEqual([
      "eu",
      "ponta-first",
      "ponta-second",
      "akane",
      "otaka",
      "unknown-first",
      "unknown-second",
    ]);
    expect(input.map((value) => value.marker)).toEqual([
      "unknown-first",
      "otaka",
      "ponta-first",
      "unknown-second",
      "eu",
      "akane",
      "ponta-second",
    ]);
  });

  it("resolves fixed IDs through the registry and preserves unknown display labels", () => {
    expect(isFixedMemberId("member_eu")).toBe(true);
    expect(isFixedMemberId("member_future")).toBe(false);
    expect(memberDisplayName("member_eu")).toBe("いーゆー");
    expect(memberDisplayName("member_future")).toBe("member_future");
    expect(memberDisplayName(null)).toBe("試合参加者に紐づけない");
  });
});
