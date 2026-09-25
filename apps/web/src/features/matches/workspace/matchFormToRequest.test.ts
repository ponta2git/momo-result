// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  toConfirmMatchRequest,
  toUpdateMatchRequest,
} from "@/features/matches/workspace/matchFormToRequest";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";

const baseIso = "2026-01-01T09:00";

function validForm(): MatchFormValues {
  return {
    ...createEmptyMatchForm(baseIso),
    gameTitleId: "gt_momotetsu_2",
    heldEventId: "held-1",
    mapMasterId: "map_east",
    seasonMasterId: "season_current",
  };
}

describe("toConfirmMatchRequest", () => {
  it("converts the local datetime input into a UTC ISO string", () => {
    const result = toConfirmMatchRequest(validForm());

    expect(result.playedAt).toBe(new Date(2026, 0, 1, 9, 0).toISOString());
  });

  it("preserves an already-ISO datetime through round-tripping", () => {
    const values = validForm();
    values.playedAt = "2026-01-01T09:00:00.000Z";

    const result = toConfirmMatchRequest(values);

    expect(result.playedAt).toBe("2026-01-01T09:00:00.000Z");
  });

  it("removes draftIds keys whose values are empty strings", () => {
    const values = validForm();
    values.draftIds = { totalAssets: "draft-1", revenue: "", incidentLog: undefined };

    const result = toConfirmMatchRequest(values);

    expect(result.draftIds).toEqual({ totalAssets: "draft-1" });
  });

  it("returns an empty draftIds object when no draft is attached", () => {
    const values = validForm();
    values.draftIds = {};

    const result = toConfirmMatchRequest(values);

    expect(result.draftIds).toEqual({});
  });

  it("keeps matchDraftId so confirming from OCR closes the source draft", () => {
    const values = validForm();
    values.matchDraftId = "match-draft-1";

    const result = toConfirmMatchRequest(values);

    expect(result.matchDraftId).toBe("match-draft-1");
  });

  it("throws ZodError when the form violates schema (rank duplicate)", () => {
    const values = validForm();
    values.players[1]!.rank = values.players[0]!.rank;

    expect(() => toConfirmMatchRequest(values)).toThrow(ZodError);
  });

  it("serializes visible numeric edits and normalizes notes without leaking editor state", () => {
    const values = validForm();
    values.numericDrafts = {
      "players.0.totalAssetsManYen": "1500",
      "players.0.revenueManYen": "-300",
      "players.0.incidents.destination": "2",
    };
    values.noteBody = "1行目\r\n2行目\r3行目";

    const result = toConfirmMatchRequest(values);

    expect(result.players![0]!.totalAssetsManYen).toBe(1500);
    expect(result.players![0]!.revenueManYen).toBe(-300);
    expect(result.players![0]!.incidents.destination).toBe(2);
    expect(result.noteBody).toBe("1行目\n2行目\n3行目");
    expect(result).not.toHaveProperty("numericDrafts");
  });

  it.each([toConfirmMatchRequest, toUpdateMatchRequest])(
    "refuses to serialize unfinished numeric edits (%#)",
    (toRequest) => {
      const values = validForm();
      values.numericDrafts = { "players.0.revenueManYen": "-" };

      expect(() => toRequest(values)).toThrow(ZodError);
    },
  );
});

describe("toUpdateMatchRequest", () => {
  it("omits creation-only draft and note fields from a result update", () => {
    const values = validForm();
    values.matchDraftId = "match-draft-1";
    values.noteBody = "既存メモは専用の更新操作が所有する";

    const result = toUpdateMatchRequest(values);

    expect(result).toEqual(expect.objectContaining({ heldEventId: "held-1" }));
    expect(result).not.toHaveProperty("matchDraftId");
    expect(result).not.toHaveProperty("noteBody");
  });
});
