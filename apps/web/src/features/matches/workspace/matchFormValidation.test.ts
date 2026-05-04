import { describe, expect, it } from "vitest";

import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { validateMatchForm } from "@/features/matches/workspace/matchFormValidation";

const baseIso = "2026-01-01T09:00";

function validForm(): MatchFormValues {
  const base = createEmptyMatchForm(baseIso);
  return {
    ...base,
    gameTitleId: "gt_momotetsu_2",
    heldEventId: "held-1",
    mapMasterId: "map_east",
    seasonMasterId: "season_current",
  };
}

describe("validateMatchForm", () => {
  it("returns success with empty messages when the form satisfies every rule", () => {
    const result = validateMatchForm(validForm());

    expect(result.success).toBe(true);
    expect(result.messages).toEqual([]);
    expect(result.pathSet.size).toBe(0);
    expect(result.firstMessage).toBeUndefined();
  });

  it("rejects duplicate ranks and surfaces the players-level message", () => {
    const values = validForm();
    values.players[1]!.rank = values.players[0]!.rank;

    const result = validateMatchForm(values);

    expect(result.success).toBe(false);
    expect(result.messages).toContain("順位は1〜4を重複なく入力してください");
    expect(result.pathSet.has("players")).toBe(true);
  });

  it("rejects rank values outside 1..4 with the per-field path", () => {
    const values = validForm();
    values.players[2]!.rank = 5;

    const result = validateMatchForm(values);

    expect(result.success).toBe(false);
    expect(result.pathSet.has("players.2.rank")).toBe(true);
  });

  it("rejects duplicate play orders with the players-level path", () => {
    const values = validForm();
    values.players[3]!.playOrder = values.players[0]!.playOrder;

    const result = validateMatchForm(values);

    expect(result.success).toBe(false);
    expect(result.messages).toContain("プレー順は1〜4を重複なく入力してください");
    expect(result.pathSet.has("players")).toBe(true);
  });

  it("rejects duplicate member selections", () => {
    const values = validForm();
    values.players[1]!.memberId = values.players[0]!.memberId;

    const result = validateMatchForm(values);

    expect(result.success).toBe(false);
    expect(result.messages).toContain("4人全員を重複なく選択してください");
    expect(result.pathSet.has("players")).toBe(true);
  });

  it("requires heldEventId and reports its message", () => {
    const values = validForm();
    values.heldEventId = "";

    const result = validateMatchForm(values);

    expect(result.success).toBe(false);
    expect(result.messages).toContain("開催履歴を選択してください");
    expect(result.pathSet.has("heldEventId")).toBe(true);
  });

  it("requires gameTitleId, mapMasterId, seasonMasterId and playedAt", () => {
    const values = validForm();
    values.gameTitleId = "";
    values.mapMasterId = "";
    values.seasonMasterId = "";
    values.playedAt = "";

    const result = validateMatchForm(values);

    expect(result.success).toBe(false);
    expect(result.messages).toEqual(
      expect.arrayContaining([
        "作品を選択してください",
        "マップを選択してください",
        "シーズンを選択してください",
        "開催日時を入力してください",
      ]),
    );
    expect(result.pathSet.has("gameTitleId")).toBe(true);
    expect(result.pathSet.has("mapMasterId")).toBe(true);
    expect(result.pathSet.has("seasonMasterId")).toBe(true);
    expect(result.pathSet.has("playedAt")).toBe(true);
  });

  it("requires matchNoInEvent to be at least 1", () => {
    const values = validForm();
    values.matchNoInEvent = 0;

    const result = validateMatchForm(values);

    expect(result.success).toBe(false);
    expect(result.messages).toContain("試合番号は1以上です");
    expect(result.pathSet.has("matchNoInEvent")).toBe(true);
  });

  it("rejects non-integer money values for totalAssetsManYen / revenueManYen", () => {
    const values = validForm();
    values.players[0]!.totalAssetsManYen = 1.5;
    values.players[0]!.revenueManYen = 2.5;

    const result = validateMatchForm(values);

    expect(result.success).toBe(false);
    expect(result.pathSet.has("players.0.totalAssetsManYen")).toBe(true);
    expect(result.pathSet.has("players.0.revenueManYen")).toBe(true);
  });

  it("exposes the first issue message via firstMessage", () => {
    const values = validForm();
    values.heldEventId = "";

    const result = validateMatchForm(values);

    expect(result.firstMessage).toBe(result.messages[0]);
    expect(result.firstMessage).toBeDefined();
  });
});
