// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createSampleDraft, createSampleDraftMap } from "@/features/draftReview/sampleDrafts";
import { draftToMatchForm } from "@/features/matches/workspace/draftToMatchForm";

const baseIso = "2026-01-01T09:00";

describe("draftToMatchForm", () => {
  it("returns form values seeded from createEmptyMatchForm when no summary is provided", () => {
    const { values } = draftToMatchForm({
      draftByKind: {},
      nowIso: baseIso,
    });

    expect(values.gameTitleId).toBe("");
    expect(values.heldEventId).toBe("");
    expect(values.mapMasterId).toBe("");
    expect(values.seasonMasterId).toBe("");
    expect(values.matchNoInEvent).toBe(1);
    expect(values.playedAt).toBe(baseIso);
    expect(values.draftIds).toEqual({});
    expect(values.players).toHaveLength(4);
  });

  it("propagates draftSummary fields and matchDraftId into the form", () => {
    const { values } = draftToMatchForm({
      draftByKind: {},
      draftSummary: {
        status: "needs_review",
        gameTitleId: "gt_world",
        heldEventId: "held-99",
        mapMasterId: "map_west",
        seasonMasterId: "season_2",
        ownerMemberId: "member_ponta",
        matchNoInEvent: 3,
        playedAt: "2026-03-01T20:00",
      },
      matchDraftId: "draft-match-1",
      nowIso: baseIso,
    });

    expect(values.gameTitleId).toBe("gt_world");
    expect(values.heldEventId).toBe("held-99");
    expect(values.mapMasterId).toBe("map_west");
    expect(values.seasonMasterId).toBe("season_2");
    expect(values.ownerMemberId).toBe("member_ponta");
    expect(values.matchNoInEvent).toBe(3);
    expect(values.playedAt).toBe("2026-03-01T20:00");
    expect(values.matchDraftId).toBe("draft-match-1");
  });

  it("builds draftIds only for slots that are present in draftByKind", () => {
    const ta = createSampleDraftMap().total_assets!;
    const { values } = draftToMatchForm({
      draftByKind: { total_assets: ta },
      nowIso: baseIso,
    });

    expect(values.draftIds.totalAssets).toBe("sample-total_assets");
    expect(values.draftIds.revenue).toBeUndefined();
    expect(values.draftIds.incidentLog).toBeUndefined();
    expect(Object.keys(values.draftIds)).toEqual(["totalAssets"]);
  });

  it("builds all three draftIds when every slot is provided", () => {
    const { values } = draftToMatchForm({
      draftByKind: createSampleDraftMap(),
      nowIso: baseIso,
    });

    expect(values.draftIds).toEqual({
      totalAssets: "sample-total_assets",
      revenue: "sample-revenue",
      incidentLog: "sample-incident_log",
    });
  });

  it("maps Japanese incident keys to the form's English incident keys", () => {
    const { values } = draftToMatchForm({
      draftByKind: { incident_log: createSampleDraft("incident_log") },
      nowIso: baseIso,
    });

    const ponta = values.players.find((player) => player.memberId === "member_ponta");
    expect(ponta).toBeDefined();
    expect(ponta?.incidents).toEqual({
      destination: 2,
      plusStation: 8,
      minusStation: 4,
      cardStation: 6,
      cardShop: 1,
      suriNoGinji: 0,
    });
  });

  it("returns initialData reflecting merged drafts when all three slots are present", () => {
    const { initialData } = draftToMatchForm({
      draftByKind: createSampleDraftMap(),
      nowIso: baseIso,
    });

    expect(initialData.originalPlayers).toHaveLength(4);
    expect(initialData.incidentByPlayOrder.size).toBe(4);
    expect(initialData.warnings).toEqual([]);
    expect(initialData.draftByKind.total_assets?.draftId).toBe("sample-total_assets");
  });

  it("emits draft-missing warnings into initialData when slots are absent", () => {
    const { initialData } = draftToMatchForm({
      draftByKind: {},
      nowIso: baseIso,
    });

    expect(initialData.warnings).toEqual([
      "総資産の読み取り結果がありません。順位と総資産は手入力してください。",
      "収益の読み取り結果がありません。収益は手入力してください。",
      "事件簿の読み取り結果がありません。事件簿は0で初期化しました。",
    ]);
  });

  it("omits matchDraftId when not provided", () => {
    const { values } = draftToMatchForm({
      draftByKind: {},
      nowIso: baseIso,
    });

    expect(values.matchDraftId).toBeUndefined();
    expect(Object.hasOwn(values, "matchDraftId")).toBe(false);
  });
});
