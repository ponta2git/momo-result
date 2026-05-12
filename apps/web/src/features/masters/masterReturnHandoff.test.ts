import { beforeEach, describe, expect, it } from "vitest";

import {
  appendHandoffIdToReturnTo,
  createDraftReviewHandoffPayload,
  findLatestMasterHandoff,
  inspectMasterHandoff,
  loadMasterHandoff,
  sanitizeReturnTo,
  saveMasterHandoff,
} from "@/shared/workflows/masterReturnHandoff";

describe("masterReturnHandoff", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("accepts app-internal returnTo paths and rejects external urls", () => {
    expect(sanitizeReturnTo("/review/session-1?sample=1")).toBe("/review/session-1?sample=1");
    expect(sanitizeReturnTo("https://example.com/review/session-1")).toBeUndefined();
    expect(sanitizeReturnTo("//example.com/review/session-1")).toBeUndefined();
  });

  it("saves and loads draft review handoff payload", () => {
    const payload = createDraftReviewHandoffPayload({
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
        players: [
          {
            incidents: {
              cardShop: 0,
              cardStation: 0,
              destination: 1,
              minusStation: 0,
              plusStation: 2,
              suriNoGinji: 0,
            },
            memberId: "member_ponta",
            playOrder: 1,
            rank: 1,
            revenueManYen: 100,
            totalAssetsManYen: 1000,
          },
        ],
        seasonMasterId: "season-1",
      },
    });

    const handoffId = saveMasterHandoff(payload);
    expect(handoffId).toBeDefined();

    const status = inspectMasterHandoff({
      expectedReturnTo: "/review/session-1?totalAssets=draft-1",
      handoffId,
    });
    expect(status.status).toBe("available");

    const loaded = loadMasterHandoff({
      expectedReturnTo: "/review/session-1?totalAssets=draft-1",
      handoffId,
    });

    expect(loaded?.matchSessionId).toBe("session-1");
    expect(loaded?.values.players[0]?.memberId).toBe("member_ponta");

    const destination = appendHandoffIdToReturnTo(
      "/review/session-1?totalAssets=draft-1",
      handoffId ?? "",
    );
    expect(destination).toContain("handoffId=");
  });

  it("marks an old handoff as expired", () => {
    const payload = createDraftReviewHandoffPayload({
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
        players: [
          {
            incidents: {
              cardShop: 0,
              cardStation: 0,
              destination: 0,
              minusStation: 0,
              plusStation: 0,
              suriNoGinji: 0,
            },
            memberId: "member_ponta",
            playOrder: 1,
            rank: 1,
            revenueManYen: 0,
            totalAssetsManYen: 0,
          },
        ],
        seasonMasterId: "season-1",
      },
    });
    payload.createdAt = "2026-01-01T00:00:00.000Z";

    const handoffId = saveMasterHandoff(payload);
    const status = inspectMasterHandoff({
      expectedReturnTo: "/review/session-1",
      handoffId,
      nowMs: Date.parse("2026-01-01T03:00:00.000Z"),
    });

    expect(status.status).toBe("expired");
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
      players: [
        {
          incidents: {
            cardShop: 0,
            cardStation: 0,
            destination: 0,
            minusStation: 0,
            plusStation: 0,
            suriNoGinji: 0,
          },
          memberId: "member_ponta",
          playOrder: 1,
          rank: 1,
          revenueManYen: 0,
          totalAssetsManYen: 0,
        },
      ],
      seasonMasterId: "season-1",
    };
    const foreign = createDraftReviewHandoffPayload({
      matchSessionId: "session-2",
      returnTo: "/review/session-1",
      values: baseValues,
    });
    foreign.createdAt = "2026-01-01T02:00:00.000Z";
    saveMasterHandoff(foreign);

    const expired = createDraftReviewHandoffPayload({
      matchSessionId: "session-1",
      returnTo: "/review/session-1",
      values: baseValues,
    });
    expired.createdAt = "2026-01-01T00:00:00.000Z";
    saveMasterHandoff(expired);

    const valid = createDraftReviewHandoffPayload({
      matchSessionId: "session-1",
      returnTo: "/review/session-1",
      values: baseValues,
    });
    valid.createdAt = "2026-01-01T01:30:00.000Z";
    const validId = saveMasterHandoff(valid);

    const latest = findLatestMasterHandoff({
      expectedMatchSessionId: "session-1",
      expectedReturnTo: "/review/session-1",
      nowMs: Date.parse("2026-01-01T01:45:00.000Z"),
    });

    expect(latest?.handoffId).toBe(validId);
    expect(latest?.payload.matchSessionId).toBe("session-1");
  });
});
