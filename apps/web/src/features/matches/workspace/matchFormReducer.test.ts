// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  createMatchFormReducerState,
  matchFormReducer,
} from "@/features/matches/workspace/matchFormReducer";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import type { IncidentLookupEntry } from "@/features/matches/workspace/matchFormTypes";

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
    evidence: {},
  };
}

describe("matchFormReducer", () => {
  it("set_play_order preserves incidents and does not mark the row as synced", () => {
    const seed = createEmptyMatchForm(baseIso);
    seed.players[2]!.incidents.destination = 7;
    const initial = createMatchFormReducerState(seed);

    const next = matchFormReducer(initial, {
      type: "set_play_order",
      index: 2,
      playOrder: 4,
    });

    expect(next.lastSyncedPlayerIndex).toBeNull();
    expect(next.values.players[2]!.playOrder).toBe(4);
    expect(next.values.players[2]!.incidents.destination).toBe(7);
  });

  it("sync_incidents_from_play_order without lookup zeroes incidents explicitly", () => {
    const seed = createEmptyMatchForm(baseIso);
    seed.players[2]!.incidents.destination = 7;
    const initial = createMatchFormReducerState(seed);

    const next = matchFormReducer(initial, {
      type: "sync_incidents_from_play_order",
      index: 2,
      playOrder: 4,
      incidentByPlayOrder: new Map(),
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

  it("atomically syncs one row and preserves other edits until that row is manually changed", () => {
    const values = {
      ...createEmptyMatchForm(baseIso),
      numericDrafts: {
        "players.0.incidents.destination": "",
        "players.0.revenueManYen": "-",
        "players.1.incidents.destination": "",
      },
    };
    const next = matchFormReducer(createMatchFormReducerState(values), {
      type: "sync_incidents_from_play_order",
      index: 0,
      playOrder: 2,
      incidentByPlayOrder: new Map([[2, entry({ 目的地: 9, プラス駅: 1, スリの銀次: 2 })]]),
    });

    expect(next.lastSyncedPlayerIndex).toBe(0);
    expect(next.values.players[0]?.playOrder).toBe(2);
    expect(next.values.players[0]?.incidents).toEqual({
      cardShop: 0,
      cardStation: 0,
      destination: 9,
      minusStation: 0,
      plusStation: 1,
      suriNoGinji: 2,
    });
    expect(next.values.players.slice(1)).toEqual(values.players.slice(1));
    expect(next.values.numericDrafts).toEqual({
      "players.0.revenueManYen": "-",
      "players.1.incidents.destination": "",
    });
    const editedElsewhere = matchFormReducer(next, {
      type: "patch_incident",
      index: 1,
      key: "destination",
      value: 3,
    });
    expect(editedElsewhere.lastSyncedPlayerIndex).toBe(0);
    expect(editedElsewhere.values.players[1]?.incidents.destination).toBe(3);

    const edited = matchFormReducer(editedElsewhere, {
      type: "patch_incident",
      index: 0,
      key: "destination",
      value: 1,
    });
    expect(edited.lastSyncedPlayerIndex).toBeNull();
    expect(edited.values.players[0]?.incidents.destination).toBe(1);
    expect(values.players[0]?.incidents.destination).toBe(0);
  });

  it("replace resets the entire state and clears lastSyncedPlayerIndex", () => {
    const initial = createMatchFormReducerState({
      ...createEmptyMatchForm(baseIso),
      numericDrafts: { "players.0.revenueManYen": "-" },
      noteBody: "以前の入力",
    });
    const synced = matchFormReducer(initial, {
      type: "sync_incidents_from_play_order",
      index: 1,
      playOrder: 4,
      incidentByPlayOrder: new Map(),
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
