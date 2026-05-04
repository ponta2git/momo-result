// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createSampleDraft } from "@/features/draftReview/sampleDrafts";
import type { MatchDraftDetailResponse } from "@/features/matches/workspace/api";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import {
  currentLocalIsoMinute,
  draftIdsFromDetail,
  draftIdsFromParams,
  draftsByKind,
  prefillFromDraftSummary,
  toIsoFromLocal,
} from "@/features/matches/workspace/workspaceDerivations";

describe("draftIdsFromParams", () => {
  it("maps URL search params to slot keys", () => {
    const params = new URLSearchParams(
      "totalAssets=ta-1&revenue=rev-1&incidentLog=inc-1&unrelated=ignored",
    );

    expect(draftIdsFromParams(params)).toEqual({
      total_assets: "ta-1",
      revenue: "rev-1",
      incident_log: "inc-1",
    });
  });

  it("omits keys whose params are missing", () => {
    const params = new URLSearchParams("totalAssets=ta-1");

    expect(draftIdsFromParams(params)).toEqual({ total_assets: "ta-1" });
  });

  it("returns an empty SlotMap when no slot params are present", () => {
    expect(draftIdsFromParams(new URLSearchParams())).toEqual({});
  });
});

describe("draftsByKind", () => {
  it("looks up drafts by id and groups them by slot kind", () => {
    const ta = createSampleDraft("total_assets");
    const rev = createSampleDraft("revenue");
    const inc = createSampleDraft("incident_log");

    const result = draftsByKind(
      { total_assets: ta.draftId, revenue: rev.draftId, incident_log: inc.draftId },
      [ta, rev, inc],
    );

    expect(result.total_assets).toBe(ta);
    expect(result.revenue).toBe(rev);
    expect(result.incident_log).toBe(inc);
  });

  it("yields undefined for slots whose ids do not appear in the draft list", () => {
    const ta = createSampleDraft("total_assets");

    const result = draftsByKind({ total_assets: ta.draftId, revenue: "missing-id" }, [ta]);

    expect(result.total_assets).toBe(ta);
    expect(result.revenue).toBeUndefined();
    expect(result.incident_log).toBeUndefined();
  });

  it("returns an empty SlotMap when drafts are undefined", () => {
    expect(draftsByKind({ total_assets: "id" }, undefined)).toEqual({
      total_assets: undefined,
      revenue: undefined,
      incident_log: undefined,
    });
  });
});

function detail(overrides: Partial<MatchDraftDetailResponse> = {}): MatchDraftDetailResponse {
  return {
    matchDraftId: "match-draft-1",
    status: "needs_review",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("draftIdsFromDetail", () => {
  it("returns an empty object when detail is undefined", () => {
    expect(draftIdsFromDetail(undefined)).toEqual({});
  });

  it("maps draft id fields to their slot kinds", () => {
    expect(
      draftIdsFromDetail(
        detail({
          totalAssetsDraftId: "ta-1",
          revenueDraftId: "rev-1",
          incidentLogDraftId: "inc-1",
        }),
      ),
    ).toEqual({
      total_assets: "ta-1",
      revenue: "rev-1",
      incident_log: "inc-1",
    });
  });

  it("omits slot keys whose ids are absent", () => {
    expect(draftIdsFromDetail(detail({ totalAssetsDraftId: "ta-1" }))).toEqual({
      total_assets: "ta-1",
    });
  });
});

describe("toIsoFromLocal", () => {
  it("returns a UTC ISO string for valid local datetime input", () => {
    const result = toIsoFromLocal("2026-01-01T09:00");

    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(new Date(result).toISOString()).toBe(result);
  });

  it("preserves an already-ISO string with explicit UTC marker", () => {
    expect(toIsoFromLocal("2026-01-01T09:00:00.000Z")).toBe("2026-01-01T09:00:00.000Z");
  });

  it("returns the input unchanged when it does not parse as a date", () => {
    expect(toIsoFromLocal("not a date")).toBe("not a date");
    expect(toIsoFromLocal("")).toBe("");
  });
});

describe("currentLocalIsoMinute", () => {
  it("formats a value as YYYY-MM-DDTHH:mm (minute precision, no seconds, no timezone)", () => {
    const result = currentLocalIsoMinute(new Date("2026-05-04T12:34:00Z"));

    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(result).toHaveLength(16);
  });

  it("uses local time (offset-corrected) so the result reads as a wall-clock minute", () => {
    const fixed = new Date("2026-05-04T12:34:00Z");
    const offsetMs = fixed.getTimezoneOffset() * 60_000;
    const expected = new Date(fixed.getTime() - offsetMs).toISOString().slice(0, 16);

    expect(currentLocalIsoMinute(fixed)).toBe(expected);
  });

  it("defaults to the current Date when no argument is passed", () => {
    const result = currentLocalIsoMinute();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("prefillFromDraftSummary", () => {
  const base = createEmptyMatchForm("2026-01-01T09:00");

  it("returns the base form unchanged when no summary is provided", () => {
    expect(prefillFromDraftSummary(base)).toEqual(base);
  });

  it("overrides only the fields the summary supplies", () => {
    const result = prefillFromDraftSummary(base, {
      status: "needs_review",
      gameTitleId: "gt_world",
      heldEventId: "held-99",
      matchNoInEvent: 5,
      playedAt: "2026-09-09T20:00",
    });

    expect(result.gameTitleId).toBe("gt_world");
    expect(result.heldEventId).toBe("held-99");
    expect(result.matchNoInEvent).toBe(5);
    expect(result.playedAt).toBe("2026-09-09T20:00");
    expect(result.mapMasterId).toBe(base.mapMasterId);
    expect(result.seasonMasterId).toBe(base.seasonMasterId);
    expect(result.ownerMemberId).toBe(base.ownerMemberId);
  });

  it("falls back to base values when summary fields are omitted", () => {
    const result = prefillFromDraftSummary(base, {
      status: "needs_review",
    });

    expect(result.gameTitleId).toBe(base.gameTitleId);
    expect(result.ownerMemberId).toBe(base.ownerMemberId);
  });

  it("does not mutate the base form", () => {
    const baseSnapshot = JSON.parse(JSON.stringify(base));
    prefillFromDraftSummary(base, {
      status: "needs_review",
      gameTitleId: "gt_world",
    });
    expect(base).toEqual(baseSnapshot);
  });
});
