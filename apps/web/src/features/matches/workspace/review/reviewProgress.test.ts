// @vitest-environment node
import { describe, expect, it } from "vitest";

import { draftToMatchForm } from "@/features/matches/workspace/draftToMatchForm";
import {
  buildReviewItems,
  countChangedReviewCells,
} from "@/features/matches/workspace/review/reviewProgress";
import { createSampleDraftMap } from "@/features/matches/workspace/review/sampleDrafts";

function preparedSample() {
  return draftToMatchForm({
    draftByKind: createSampleDraftMap(),
    nowIso: "2026-01-01T00:00:00.000Z",
  });
}

describe("reviewProgress", () => {
  it("orders field warnings by the same scan order as the result grid", () => {
    const prepared = preparedSample();

    const items = buildReviewItems({
      incidentByPlayOrder: prepared.initialData.incidentByPlayOrder,
      originalPlayers: prepared.initialData.originalPlayers,
      players: prepared.values.players,
    });

    expect(items.map((item) => [item.row, item.field, item.sourceKind])).toEqual([
      [1, "memberId", "total_assets"],
      [2, "rank", "total_assets"],
    ]);
    expect(items[0]?.message).toBe("既知エイリアスで解決");
    expect(items[1]?.message).toBe("順位の視認性が低い");
  });

  it("counts only values that differ from their OCR source", () => {
    const prepared = preparedSample();
    const changedPlayers = structuredClone(prepared.values.players);
    changedPlayers[0]!.totalAssetsManYen += 1;
    changedPlayers[0]!.incidents.destination += 1;

    expect(
      countChangedReviewCells({
        incidentByPlayOrder: prepared.initialData.incidentByPlayOrder,
        originalPlayers: prepared.initialData.originalPlayers,
        players: changedPlayers,
      }),
    ).toBe(2);
  });
});
