import { describe, expect, it } from "vitest";

import { draftToMatchForm } from "@/features/matches/workspace/draftToMatchForm";
import { createMatchWorkspaceEditingStore } from "@/features/matches/workspace/matchWorkspaceEditingStore";
import { createSampleDraftMap } from "@/features/matches/workspace/review/sampleDrafts";

const now = "2026-01-01T00:00:00.000Z";
function reviewStore() {
  const initial = draftToMatchForm({ draftByKind: createSampleDraftMap(), nowIso: now });
  const store = createMatchWorkspaceEditingStore(now);
  store.initialize(initial.values, initial.initialData);
  return store;
}

describe("workspace editing publication", () => {
  it("publishes numeric commit, draft removal and acknowledgement together to every reader", () => {
    const store = reviewStore();
    const path = "players.0.revenueManYen";
    const cellId = "player-0-revenueManYen";
    store.actions.changeNumericDraft(path, "-42");
    const observed: unknown[] = [];
    const inspect = () =>
      observed.push({
        value: store.scoreRows[0]!.getSnapshot().player.revenueManYen,
        draft: store.persistence.getSnapshot().values.numericDrafts?.[path],
        reviewed: store.review.getSnapshot().acknowledgedCellIds.includes(cellId),
      });
    store.scoreRows[0]!.subscribe(inspect);
    store.persistence.subscribe(inspect);
    store.review.subscribe(inspect);

    store.actions.changePlayer(0, "revenueManYen", -42);

    expect(observed).toHaveLength(3);
    for (const value of observed)
      expect(value).toEqual({ value: -42, draft: undefined, reviewed: true });
  });

  it("retains unrelated row/setup/confirmation snapshots while unfinished text changes", () => {
    const store = reviewStore();
    const setup = store.setup.getSnapshot();
    const otherRow = store.scoreRows[1]!.getSnapshot();
    const confirmation = store.confirmation.getSnapshot();
    const changedRow = store.scoreRows[0]!.getSnapshot();
    store.actions.changeNumericDraft("players.0.revenueManYen", "-");
    expect(store.scoreRows[0]!.getSnapshot()).not.toBe(changedRow);
    expect(store.scoreRows[1]!.getSnapshot()).toBe(otherRow);
    expect(store.setup.getSnapshot()).toBe(setup);
    expect(store.confirmation.getSnapshot()).toBe(confirmation);
    const row = store.scoreRows[0]!.getSnapshot();
    store.actions.changeNote("メモだけを更新");
    expect(store.scoreRows[0]!.getSnapshot()).toBe(row);
    expect(store.setup.getSnapshot()).toBe(setup);
  });

  it("changes play order with incident replacement and acknowledgement invalidation in one publication", () => {
    const store = reviewStore();
    const incident = "player-0-incident.destination";
    store.actions.acknowledge(incident);
    store.actions.changeNumericDraft("players.0.incidents.destination", "-");
    const observed: unknown[] = [];
    store.persistence.subscribe(() =>
      observed.push({
        order: store.scoreRows[0]!.getSnapshot().player.playOrder,
        draft: store.scoreRows[0]!.getSnapshot().numericDrafts["players.0.incidents.destination"],
        acknowledged: store.review.getSnapshot().acknowledgedCellIds,
      }),
    );
    store.actions.changePlayOrder(0, 2);
    expect(observed).toEqual([
      { order: 2, draft: undefined, acknowledged: ["player-0-playOrder"] },
    ]);
  });
});
