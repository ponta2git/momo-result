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

    expect(result.playedAt).not.toBe(baseIso);
    expect(result.playedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(new Date(result.playedAt).toISOString()).toBe(result.playedAt);
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
    expect(Object.keys(result.draftIds)).not.toContain("revenue");
    expect(Object.keys(result.draftIds)).not.toContain("incidentLog");
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

  it("forwards player rows verbatim into the request payload", () => {
    const values = validForm();
    values.players[0]!.totalAssetsManYen = 1500;
    values.players[0]!.revenueManYen = 300;
    values.players[0]!.incidents.destination = 2;

    const result = toConfirmMatchRequest(values);

    expect(result.players![0]!.totalAssetsManYen).toBe(1500);
    expect(result.players![0]!.revenueManYen).toBe(300);
    expect(result.players![0]!.incidents.destination).toBe(2);
  });
});

describe("toUpdateMatchRequest", () => {
  it("omits matchDraftId because the update endpoint does not accept it", () => {
    const values = validForm();
    values.matchDraftId = "match-draft-1";

    const result = toUpdateMatchRequest(values);

    expect(result).toEqual(expect.objectContaining({ heldEventId: "held-1" }));
    expect("matchDraftId" in result).toBe(false);
  });
});
