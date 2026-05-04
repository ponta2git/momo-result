import { describe, expect, it } from "vitest";

import type { IncidentLookupEntry } from "@/features/draftReview/mergeDrafts";
import {
  createMatchFormReducerState,
  matchFormReducer,
  playerFieldPatch,
} from "@/features/matches/workspace/matchFormReducer";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";

const baseIso = "2026-01-01T09:00";

function entry(counts: Partial<IncidentLookupEntry["counts"]>): IncidentLookupEntry {
  return {
    counts: {
      目的地: 0,
      プラス駅: 0,
      マイナス駅: 0,
      カード駅: 0,
      カード売り場: 0,
      スリの銀次: 0,
      ...counts,
    },
    confidence: {},
  };
}

describe("matchFormReducer", () => {
  it("createMatchFormReducerState seeds lastSyncedPlayerIndex as null", () => {
    const state = createMatchFormReducerState(createEmptyMatchForm(baseIso));

    expect(state.lastSyncedPlayerIndex).toBeNull();
    expect(state.values.players).toHaveLength(4);
  });

  it("patch_root merges top-level fields without touching players", () => {
    const initial = createMatchFormReducerState(createEmptyMatchForm(baseIso));
    const next = matchFormReducer(initial, {
      type: "patch_root",
      patch: { gameTitleId: "gt_x", heldEventId: "held-1" },
    });

    expect(next.values.gameTitleId).toBe("gt_x");
    expect(next.values.heldEventId).toBe("held-1");
    expect(next.values.players).toBe(initial.values.players);
    expect(initial.values.gameTitleId).toBe("");
  });

  it("patch_player updates only the targeted player and preserves others by reference", () => {
    const initial = createMatchFormReducerState(createEmptyMatchForm(baseIso));
    const next = matchFormReducer(initial, {
      type: "patch_player",
      index: 1,
      patch: playerFieldPatch("totalAssetsManYen", 1234),
    });

    expect(next.values.players[1]!.totalAssetsManYen).toBe(1234);
    expect(next.values.players[0]).toBe(initial.values.players[0]);
    expect(next.values.players[2]).toBe(initial.values.players[2]);
    expect(initial.values.players[1]!.totalAssetsManYen).toBe(0);
  });

  it("patch_incident updates the incident value", () => {
    const initial = createMatchFormReducerState(createEmptyMatchForm(baseIso));
    const next = matchFormReducer(initial, {
      type: "patch_incident",
      index: 0,
      key: "destination",
      value: 3,
    });

    expect(next.values.players[0]!.incidents.destination).toBe(3);
    expect(next.values.players[1]!.incidents.destination).toBe(0);
  });

  it("patch_incident clears lastSyncedPlayerIndex only when it matches the edited index", () => {
    const seed = createMatchFormReducerState(createEmptyMatchForm(baseIso));
    const synced = { ...seed, lastSyncedPlayerIndex: 2 };

    const sameIndex = matchFormReducer(synced, {
      type: "patch_incident",
      index: 2,
      key: "plusStation",
      value: 1,
    });
    expect(sameIndex.lastSyncedPlayerIndex).toBeNull();

    const differentIndex = matchFormReducer(synced, {
      type: "patch_incident",
      index: 0,
      key: "plusStation",
      value: 1,
    });
    expect(differentIndex.lastSyncedPlayerIndex).toBe(2);
  });

  it("set_play_order syncs incidents from incidentByPlayOrder and remembers the index", () => {
    const initial = createMatchFormReducerState(createEmptyMatchForm(baseIso));
    const incidentByPlayOrder = new Map<number, IncidentLookupEntry>([
      [3, entry({ 目的地: 5, プラス駅: 1, スリの銀次: 2 })],
    ]);

    const next = matchFormReducer(initial, {
      type: "set_play_order",
      index: 1,
      playOrder: 3,
      incidentByPlayOrder,
    });

    expect(next.lastSyncedPlayerIndex).toBe(1);
    expect(next.values.players[1]!.playOrder).toBe(3);
    expect(next.values.players[1]!.incidents).toEqual({
      cardShop: 0,
      cardStation: 0,
      destination: 5,
      minusStation: 0,
      plusStation: 1,
      suriNoGinji: 2,
    });
    expect(next.values.players[0]).toBe(initial.values.players[0]);
  });

  it("set_play_order without lookup zeroes the incidents", () => {
    const seed = createEmptyMatchForm(baseIso);
    seed.players[2]!.incidents.destination = 7;
    const initial = createMatchFormReducerState(seed);

    const next = matchFormReducer(initial, {
      type: "set_play_order",
      index: 2,
      playOrder: 4,
    });

    expect(next.lastSyncedPlayerIndex).toBe(2);
    expect(next.values.players[2]!.playOrder).toBe(4);
    expect(next.values.players[2]!.incidents).toEqual({
      cardShop: 0,
      cardStation: 0,
      destination: 0,
      minusStation: 0,
      plusStation: 0,
      suriNoGinji: 0,
    });
  });

  it("subsequent patch_incident on the just-synced index clears lastSyncedPlayerIndex", () => {
    const initial = createMatchFormReducerState(createEmptyMatchForm(baseIso));
    const synced = matchFormReducer(initial, {
      type: "set_play_order",
      index: 0,
      playOrder: 2,
      incidentByPlayOrder: new Map([[2, entry({ 目的地: 9 })]]),
    });
    expect(synced.lastSyncedPlayerIndex).toBe(0);

    const edited = matchFormReducer(synced, {
      type: "patch_incident",
      index: 0,
      key: "destination",
      value: 1,
    });

    expect(edited.lastSyncedPlayerIndex).toBeNull();
    expect(edited.values.players[0]!.incidents.destination).toBe(1);
  });

  it("replace resets the entire state and clears lastSyncedPlayerIndex", () => {
    const initial = createMatchFormReducerState(createEmptyMatchForm(baseIso));
    const synced = matchFormReducer(initial, {
      type: "set_play_order",
      index: 1,
      playOrder: 4,
    });
    expect(synced.lastSyncedPlayerIndex).toBe(1);

    const replacement = createEmptyMatchForm("2026-02-02T10:00");
    const next = matchFormReducer(synced, {
      type: "replace",
      payload: replacement,
    });

    expect(next.lastSyncedPlayerIndex).toBeNull();
    expect(next.values).toEqual(replacement);
  });
});

describe("playerFieldPatch", () => {
  it("returns a single-key partial for the given field", () => {
    expect(playerFieldPatch("rank", 3)).toEqual({ rank: 3 });
    expect(playerFieldPatch("revenueManYen", 50)).toEqual({ revenueManYen: 50 });
  });
});
