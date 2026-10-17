// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import type {
  IncidentLookupEntry,
  MatchFormValues,
} from "@/features/matches/workspace/matchFormTypes";
import {
  createMatchWorkspaceEditingState,
  transitionMatchWorkspaceEditing as editWorkspace,
} from "@/features/matches/workspace/matchWorkspaceEditing";

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

function reviewState(
  values: MatchFormValues,
  incidentByPlayOrder = new Map<number, IncidentLookupEntry>(),
) {
  return editWorkspace(createMatchWorkspaceEditingState(values), {
    type: "initialize",
    values,
    initialData: { draftByKind: {}, incidentByPlayOrder, originalPlayers: [], warnings: [] },
  });
}

describe("workspace editing transitions", () => {
  it("clears game-dependent selections while preserving other input when the game changes", () => {
    const values = {
      ...createEmptyMatchForm(baseIso),
      gameTitleId: "previous-game",
      mapMasterId: "previous-map",
      seasonMasterId: "previous-season",
      numericDrafts: { "players.0.revenueManYen": "-" },
      noteBody: "保持する入力",
    };
    const initial = createMatchWorkspaceEditingState(values);

    const next = editWorkspace(initial, {
      field: "gameTitleId",
      value: "next-game",
      type: "change-setup",
    });

    expect(next.values).toEqual({
      ...values,
      gameTitleId: "next-game",
      mapMasterId: "",
      seasonMasterId: "",
    });
    expect(values.mapMasterId).toBe("previous-map");
    expect(values.seasonMasterId).toBe("previous-season");
  });

  it("keeps manually entered incidents when the play order changes without OCR input", () => {
    const seed = createEmptyMatchForm(baseIso);
    seed.players[2]!.incidents.destination = 7;
    const initial = createMatchWorkspaceEditingState(seed);

    const next = editWorkspace(initial, {
      type: "change-play-order",
      index: 2,
      value: 4,
    });

    expect(next.lastSyncedPlayerIndex).toBeNull();
    expect(next.values.players[2]!.playOrder).toBe(4);
    expect(next.values.players[2]!.incidents.destination).toBe(7);
  });

  it("clears incidents when the chosen play order has no OCR incident row", () => {
    const seed = createEmptyMatchForm(baseIso);
    seed.players[2]!.incidents.destination = 7;
    const initial = reviewState(seed);

    const next = editWorkspace(initial, {
      type: "change-play-order",
      index: 2,
      value: 4,
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
    const initial = reviewState(
      values,
      new Map([[2, entry({ 目的地: 9, プラス駅: 1, スリの銀次: 2 })]]),
    );
    const reviewed = editWorkspace(initial, {
      type: "acknowledge",
      cellId: "player-0-incident.destination",
    });
    const next = editWorkspace(reviewed, {
      type: "change-play-order",
      index: 0,
      value: 2,
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
    expect(next.values.players[1]).toBe(values.players[1]);
    expect(next.acknowledgedCellIds).toEqual(["player-0-playOrder"]);
    expect(next.values.numericDrafts).toEqual({
      "players.0.revenueManYen": "-",
      "players.1.incidents.destination": "",
    });
    const editedElsewhere = editWorkspace(next, {
      type: "change-incident",
      index: 1,
      key: "destination",
      value: 3,
    });
    expect(editedElsewhere.lastSyncedPlayerIndex).toBe(0);
    expect(editedElsewhere.values.players[1]?.incidents.destination).toBe(3);

    const edited = editWorkspace(editedElsewhere, {
      type: "change-incident",
      index: 0,
      key: "destination",
      value: 1,
    });
    expect(edited.lastSyncedPlayerIndex).toBeNull();
    expect(edited.values.players[0]?.incidents.destination).toBe(1);
    expect(values.players[0]?.incidents.destination).toBe(0);
  });

  it("initialization replaces input and resets the previous review state", () => {
    const initial = reviewState({
      ...createEmptyMatchForm(baseIso),
      numericDrafts: { "players.0.revenueManYen": "-" },
      noteBody: "以前の入力",
    });
    const synced = editWorkspace(initial, {
      type: "change-play-order",
      index: 1,
      value: 4,
    });
    expect(synced.lastSyncedPlayerIndex).toBe(1);

    const replacement = createEmptyMatchForm("2026-02-02T10:00");
    const next = editWorkspace(synced, {
      type: "initialize",
      values: replacement,
      initialData: null,
    });

    expect(next.lastSyncedPlayerIndex).toBeNull();
    expect(next.values).toEqual(replacement);
    expect(next.acknowledgedCellIds).toEqual([]);
    expect(next.activeCellId).toBeNull();
    expect(next.initialData).toBeNull();
  });
});
