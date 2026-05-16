// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  appendHandoffIdToReturnTo,
  createMatchWorkspaceMasterHandoffPayload,
  findLatestMasterHandoff,
  inspectMasterHandoff,
  loadMasterHandoff,
  prepareMatchWorkspaceMasterHandoffRoute,
  sanitizeReturnTo,
  saveMasterHandoff,
} from "@/shared/workflows/matchWorkspaceMasterHandoff";

const memberIds = ["member_ponta", "member_akane_mami", "member_otaka", "member_eu"] as const;

function handoffPlayers(
  overrides: {
    destination?: number;
    plusStation?: number;
    revenueManYen?: number;
    totalAssetsManYen?: number;
  } = {},
) {
  return memberIds.map((memberId, index) => ({
    incidents: {
      cardShop: 0,
      cardStation: 0,
      destination: overrides.destination ?? 0,
      minusStation: 0,
      plusStation: overrides.plusStation ?? 0,
      suriNoGinji: 0,
    },
    memberId,
    playOrder: index + 1,
    rank: index + 1,
    revenueManYen: overrides.revenueManYen ?? 0,
    totalAssetsManYen: overrides.totalAssetsManYen ?? 0,
  }));
}

describe("matchWorkspaceMasterHandoff", () => {
  it("accepts app-internal returnTo paths and rejects external urls", () => {
    expect(sanitizeReturnTo("/review/session-1?sample=1")).toBe("/review/session-1?sample=1");
    expect(sanitizeReturnTo("https://example.com/review/session-1")).toBeUndefined();
    expect(sanitizeReturnTo("//example.com/review/session-1")).toBeUndefined();
  });

  it("saves and loads draft review handoff payload", () => {
    const payload = createMatchWorkspaceMasterHandoffPayload({
      createdAt: "2026-01-01T00:00:00.000Z",
      matchSessionId: "session-1",
      returnTo: "/review/session-1?totalAssets=draft-1",
      values: {
        draftIds: {
          incidentLog: "draft-3",
          revenue: "draft-2",
          totalAssets: "draft-1",
        },
        gameTitleId: "gt_momotetsu_2",
        heldEventId: "event-1",
        mapMasterId: "map-east",
        matchNoInEvent: 1,
        ownerMemberId: "member_ponta",
        playedAt: "2026-01-01T00:00:00.000Z",
        players: handoffPlayers({
          destination: 1,
          plusStation: 2,
          revenueManYen: 100,
          totalAssetsManYen: 1000,
        }),
        seasonMasterId: "season-1",
      },
    });

    const handoffId = saveMasterHandoff(payload, { createId: () => "handoff-1" });
    expect(handoffId).toBe("handoff-1");

    const status = inspectMasterHandoff({
      expectedReturnTo: "/review/session-1?totalAssets=draft-1",
      handoffId,
      nowMs: Date.parse("2026-01-01T00:30:00.000Z"),
    });
    expect(status.status).toBe("available");

    const loaded = loadMasterHandoff({
      expectedReturnTo: "/review/session-1?totalAssets=draft-1",
      handoffId,
      nowMs: Date.parse("2026-01-01T00:30:00.000Z"),
    });

    expect(loaded?.matchSessionId).toBe("session-1");
    expect(loaded?.values.players[0]?.memberId).toBe("member_ponta");

    const destination = appendHandoffIdToReturnTo(
      "/review/session-1?totalAssets=draft-1",
      handoffId ?? "",
    );
    expect(destination).toContain("handoffId=handoff-1");
  });

  it("marks an old handoff as expired", () => {
    const payload = createMatchWorkspaceMasterHandoffPayload({
      createdAt: "2026-01-01T00:00:00.000Z",
      matchSessionId: "session-1",
      returnTo: "/review/session-1",
      values: {
        draftIds: {},
        gameTitleId: "gt_momotetsu_2",
        heldEventId: "event-1",
        mapMasterId: "map-east",
        matchNoInEvent: 1,
        ownerMemberId: "member_ponta",
        playedAt: "2026-01-01T00:00:00.000Z",
        players: handoffPlayers(),
        seasonMasterId: "season-1",
      },
    });

    const handoffId = saveMasterHandoff(payload, { createId: () => "expired-handoff" });
    const status = inspectMasterHandoff({
      expectedReturnTo: "/review/session-1",
      handoffId,
      nowMs: Date.parse("2026-01-01T03:00:00.000Z"),
    });

    expect(status.status).toBe("expired");
  });

  it("does not build a master route when session storage cannot persist the handoff", () => {
    const unavailableStorage = {
      getItem: () => null,
      key: () => null,
      length: 0,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };

    const result = prepareMatchWorkspaceMasterHandoffRoute({
      createId: () => "unavailable-handoff",
      matchSessionId: "session-1",
      returnTo: "/review/session-1",
      storage: unavailableStorage,
      values: {
        draftIds: {},
        gameTitleId: "gt_momotetsu_2",
        heldEventId: "event-1",
        mapMasterId: "map-east",
        matchNoInEvent: 1,
        ownerMemberId: "member_ponta",
        playedAt: "2026-01-01T00:00:00.000Z",
        players: handoffPlayers(),
        seasonMasterId: "season-1",
      },
    });

    expect(result.status).toBe("unavailable");
  });

  it("finds latest handoff only through validated return and session contracts", () => {
    const baseValues = {
      draftIds: {},
      gameTitleId: "gt_momotetsu_2",
      heldEventId: "event-1",
      mapMasterId: "map-east",
      matchNoInEvent: 1,
      ownerMemberId: "member_ponta",
      playedAt: "2026-01-01T00:00:00.000Z",
      players: handoffPlayers(),
      seasonMasterId: "season-1",
    };
    const foreign = createMatchWorkspaceMasterHandoffPayload({
      createdAt: "2026-01-01T02:00:00.000Z",
      matchSessionId: "session-2",
      returnTo: "/review/session-1",
      values: baseValues,
    });
    saveMasterHandoff(foreign, { createId: () => "foreign-handoff" });

    const expired = createMatchWorkspaceMasterHandoffPayload({
      createdAt: "2026-01-01T00:00:00.000Z",
      matchSessionId: "session-1",
      returnTo: "/review/session-1",
      values: baseValues,
    });
    saveMasterHandoff(expired, { createId: () => "old-handoff" });

    const valid = createMatchWorkspaceMasterHandoffPayload({
      createdAt: "2026-01-01T01:30:00.000Z",
      matchSessionId: "session-1",
      returnTo: "/review/session-1",
      values: baseValues,
    });
    const validId = saveMasterHandoff(valid, { createId: () => "valid-handoff" });

    const latest = findLatestMasterHandoff({
      expectedMatchSessionId: "session-1",
      expectedReturnTo: "/review/session-1",
      nowMs: Date.parse("2026-01-01T01:45:00.000Z"),
    });

    expect(latest?.handoffId).toBe(validId);
    expect(latest?.payload.matchSessionId).toBe("session-1");
  });
});
