import { describe, expect, it } from "vitest";

import {
  classifyReturnTo,
  currentInternalLocation,
  isSameResourceReturnTo,
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

  it("classifies exact route identities without discarding query or fragment conditions", () => {
    expect(classifyReturnTo("/matches?cursor=older#results")).toEqual({ kind: "matchList" });
    expect(classifyReturnTo("/matches/match%2F1?returnTo=%2Fmatches#note")).toEqual({
      kind: "matchDetail",
      matchId: "match/1",
    });
    expect(classifyReturnTo("/held-events/held-1?page=2")).toEqual({
      kind: "heldEventDetail",
      heldEventId: "held-1",
    });
    expect(classifyReturnTo("/held-events?page=2")).toEqual({ kind: "heldEventList" });
    expect(classifyReturnTo("/analytics/series?focusMatchId=match-1")).toEqual({
      kind: "seriesComparison",
    });
    for (const path of [
      "/matches/new",
      "/matches/%6Eew",
      "/matches/match-1/edit",
      "/matches-extra",
    ]) {
      expect(classifyReturnTo(path)).toEqual({ kind: "internal" });
    }
    expect(classifyReturnTo("https://outside.example/matches")).toEqual({ kind: "none" });
  });

  it("rejects a self return independently of query, fragment and identifier encoding", () => {
    expect(isSameResourceReturnTo("/matches/%6Datch-1?view=other#note", "/matches/match-1")).toBe(
      true,
    );
    expect(
      isSameResourceReturnTo("/held-events/held-1/?returnTo=%2Fmatches", "/held-events/held-1"),
    ).toBe(true);
    expect(isSameResourceReturnTo("/matches/match-2", "/matches/match-1")).toBe(false);
    expect(isSameResourceReturnTo("/matches?page=1", "/matches/match-1")).toBe(false);
    expect(isSameResourceReturnTo("/held-events/match-1", "/matches/match-1")).toBe(false);
    expect(isSameResourceReturnTo("/matches/%invalid", "/matches/%invalid")).toBe(false);
  });
});
