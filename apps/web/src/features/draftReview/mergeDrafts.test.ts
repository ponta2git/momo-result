// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { OcrDraftResponse } from "@/features/draftReview/api";
import { mergeDrafts } from "@/features/draftReview/mergeDrafts";

const field = <T>(value: T, confidence = 0.96) => ({
  value,
  raw_text: String(value),
  confidence,
  warnings: [],
});

function draft(kind: "total_assets" | "revenue" | "incident_log"): OcrDraftResponse {
  return {
    draftId: `draft-${kind}`,
    jobId: `job-${kind}`,
    requestedImageType: kind,
    detectedImageType: kind,
    payloadJson: {
      requested_screen_type: kind,
      detected_screen_type: kind,
      profile_id: null,
      players: [
        {
          raw_player_name: field("NO11社長"),
          member_id: null,
          play_order: field(2),
          rank: field(1),
          total_assets_man_yen: field(1200),
          revenue_man_yen: field(300),
          incidents: {
            目的地: field(2),
            プラス駅: field(3),
          },
        },
      ],
      category_payload: {},
      warnings: [],
      raw_snippets: null,
    },
    warningsJson: [],
    timingsMsJson: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("mergeDrafts", () => {
  it("uses aliases and maps Japanese incidents to review rows", () => {
    const merged = mergeDrafts({
      total_assets: draft("total_assets"),
      revenue: draft("revenue"),
      incident_log: draft("incident_log"),
    });

    expect(merged.players[0]).toMatchObject({
      memberId: "member_akane_mami",
      playOrder: 2,
      rank: 1,
      totalAssetsManYen: 1200,
      revenueManYen: 300,
    });
    expect(merged.players[0]?.incidents["目的地"]).toBe(2);
    expect(merged.players[0]?.incidents["カード駅"]).toBe(0);
  });

  it("matches incident_log entries by play_order even when member_id is unresolved", () => {
    const totalAssetsDraft: OcrDraftResponse = {
      draftId: "draft-total-assets",
      jobId: "job-total-assets",
      requestedImageType: "total_assets",
      detectedImageType: "total_assets",
      payloadJson: {
        requested_screen_type: "total_assets",
        detected_screen_type: "total_assets",
        profile_id: null,
        // total_assets は順位 (rank) 順で並ぶ。プレイ順は色から判定された値が入る。
        players: [
          {
            raw_player_name: field("ぽんた"),
            member_id: "member_ponta",
            play_order: field(3),
            rank: field(1),
            total_assets_man_yen: field(2000),
            revenue_man_yen: field(null),
            incidents: {},
          },
          {
            raw_player_name: field("いーゆー"),
            member_id: "member_eu",
            play_order: field(1),
            rank: field(2),
            total_assets_man_yen: field(1500),
            revenue_man_yen: field(null),
            incidents: {},
          },
        ],
        category_payload: {},
        warnings: [],
        raw_snippets: null,
      },
      warningsJson: [],
      timingsMsJson: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const incidentDraft: OcrDraftResponse = {
      draftId: "draft-incident",
      jobId: "job-incident",
      requestedImageType: "incident_log",
      detectedImageType: "incident_log",
      payloadJson: {
        requested_screen_type: "incident_log",
        detected_screen_type: "incident_log",
        profile_id: null,
        // incident_log は列位置 (play_order) 順で並ぶ。OCR が名前/member_id を解決できない場合あり。
        players: [
          {
            raw_player_name: field(null),
            member_id: null,
            play_order: field(1),
            rank: field(null),
            total_assets_man_yen: field(null),
            revenue_man_yen: field(null),
            incidents: { 目的地: field(11) },
          },
          {
            raw_player_name: field(null),
            member_id: null,
            play_order: field(3),
            rank: field(null),
            total_assets_man_yen: field(null),
            revenue_man_yen: field(null),
            incidents: { 目的地: field(33) },
          },
        ],
        category_payload: {},
        warnings: [],
        raw_snippets: null,
      },
      warningsJson: [],
      timingsMsJson: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const merged = mergeDrafts({
      total_assets: totalAssetsDraft,
      incident_log: incidentDraft,
    });

    // play_order=3 のぽんた → 事件数 33、play_order=1 のいーゆー → 事件数 11
    const ponta = merged.players.find((player) => player.memberId === "member_ponta");
    const eu = merged.players.find((player) => player.memberId === "member_eu");
    expect(ponta?.incidents["目的地"]).toBe(33);
    expect(eu?.incidents["目的地"]).toBe(11);
  });

  it("strips 社長 suffix and avoids duplicate memberIds across players", () => {
    const totalAssetsDraft: OcrDraftResponse = {
      draftId: "draft-total-assets",
      jobId: "job-total-assets",
      requestedImageType: "total_assets",
      detectedImageType: "total_assets",
      payloadJson: {
        requested_screen_type: "total_assets",
        detected_screen_type: "total_assets",
        profile_id: null,
        // OCR が「社長」サフィックス付きで読んだ名前。
        // 「ぽんた社長」は素朴な完全一致ではマッチしないので
        // (a) サフィックス除去で member_ponta にマッチさせる必要があり、
        // (b) フォールバック先が「NO11社長」(あかねまみ) と重複しないこと。
        players: [
          {
            raw_player_name: field("いーゆー社長"),
            member_id: null,
            play_order: field(4),
            rank: field(1),
            total_assets_man_yen: field(105470),
            revenue_man_yen: field(null),
            incidents: {},
          },
          {
            raw_player_name: field("ぽんた社長"),
            member_id: null,
            play_order: field(null),
            rank: field(2),
            total_assets_man_yen: field(91870),
            revenue_man_yen: field(null),
            incidents: {},
          },
          {
            raw_player_name: field("NO11社長"),
            member_id: null,
            play_order: field(null),
            rank: field(3),
            total_assets_man_yen: field(68820),
            revenue_man_yen: field(null),
            incidents: {},
          },
          {
            raw_player_name: field("オータカ社長"),
            member_id: null,
            play_order: field(2),
            rank: field(4),
            total_assets_man_yen: field(33560),
            revenue_man_yen: field(null),
            incidents: {},
          },
        ],
        category_payload: {},
        warnings: [],
        raw_snippets: null,
      },
      warningsJson: [],
      timingsMsJson: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const merged = mergeDrafts({ total_assets: totalAssetsDraft });

    const memberIdSet = new Set(merged.players.map((player) => player.memberId));
    expect(memberIdSet.size).toBe(merged.players.length);
    expect(memberIdSet).toEqual(
      new Set(["member_eu", "member_ponta", "member_akane_mami", "member_otaka"]),
    );
    expect(merged.players.find((p) => p.rank === 1)?.memberId).toBe("member_eu");
    expect(merged.players.find((p) => p.rank === 2)?.memberId).toBe("member_ponta");
    expect(merged.players.find((p) => p.rank === 3)?.memberId).toBe("member_akane_mami");
    expect(merged.players.find((p) => p.rank === 4)?.memberId).toBe("member_otaka");
  });

  it("avoids play_order collision when total_assets has unresolved play_order", () => {
    // 回帰テスト: total_assets で play_order=null の行に index+1 をフォールバックすると、
    // 別行で OCR が検出済みの play_order と衝突して同じ事件簿行を引いてしまう。
    // 衝突を避けて未使用の play_order を割り当てるべき。
    const totalAssetsDraft: OcrDraftResponse = {
      draftId: "draft-total-assets",
      jobId: "job-total-assets",
      requestedImageType: "total_assets",
      detectedImageType: "total_assets",
      payloadJson: {
        requested_screen_type: "total_assets",
        detected_screen_type: "total_assets",
        profile_id: null,
        players: [
          {
            raw_player_name: field("いーゆー社長"),
            member_id: null,
            play_order: field(4),
            rank: field(1),
            total_assets_man_yen: field(105470),
            revenue_man_yen: field(null),
            incidents: {},
          },
          {
            raw_player_name: field("ぽんた社長"),
            member_id: null,
            play_order: field(null),
            rank: field(2),
            total_assets_man_yen: field(91870),
            revenue_man_yen: field(null),
            incidents: {},
          },
          {
            raw_player_name: field("NO11社長"),
            member_id: null,
            play_order: field(null),
            rank: field(3),
            total_assets_man_yen: field(68820),
            revenue_man_yen: field(null),
            incidents: {},
          },
          {
            raw_player_name: field("オータカ社長"),
            member_id: null,
            play_order: field(2),
            rank: field(4),
            total_assets_man_yen: field(33560),
            revenue_man_yen: field(null),
            incidents: {},
          },
        ],
        category_payload: {},
        warnings: [],
        raw_snippets: null,
      },
      warningsJson: [],
      timingsMsJson: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const incidentDraft: OcrDraftResponse = {
      draftId: "draft-incident",
      jobId: "job-incident",
      requestedImageType: "incident_log",
      detectedImageType: "incident_log",
      payloadJson: {
        requested_screen_type: "incident_log",
        detected_screen_type: "incident_log",
        profile_id: null,
        players: [
          {
            raw_player_name: field(null),
            member_id: null,
            play_order: field(1),
            rank: field(null),
            total_assets_man_yen: field(null),
            revenue_man_yen: field(null),
            incidents: { 目的地: field(11) },
          },
          {
            raw_player_name: field(null),
            member_id: null,
            play_order: field(2),
            rank: field(null),
            total_assets_man_yen: field(null),
            revenue_man_yen: field(null),
            incidents: { 目的地: field(22) },
          },
          {
            raw_player_name: field(null),
            member_id: null,
            play_order: field(3),
            rank: field(null),
            total_assets_man_yen: field(null),
            revenue_man_yen: field(null),
            incidents: { 目的地: field(33) },
          },
          {
            raw_player_name: field(null),
            member_id: null,
            play_order: field(4),
            rank: field(null),
            total_assets_man_yen: field(null),
            revenue_man_yen: field(null),
            incidents: { 目的地: field(44) },
          },
        ],
        category_payload: {},
        warnings: [],
        raw_snippets: null,
      },
      warningsJson: [],
      timingsMsJson: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const merged = mergeDrafts({
      total_assets: totalAssetsDraft,
      incident_log: incidentDraft,
    });

    const incidents = merged.players.map((player) => player.incidents["目的地"]);
    // 全プレイヤーの目的地数が一意 (= 衝突せず別の play_order を引いている) こと
    expect(new Set(incidents).size).toBe(4);
    // 具体的な割当: 検出済み play_order=4,2 はそのまま、null は残った 1,3 に割当
    const eu = merged.players.find((p) => p.rank === 1);
    const ponta = merged.players.find((p) => p.rank === 2);
    const akane = merged.players.find((p) => p.rank === 3);
    const otaka = merged.players.find((p) => p.rank === 4);
    expect(eu?.playOrder).toBe(4);
    expect(eu?.incidents["目的地"]).toBe(44);
    expect(otaka?.playOrder).toBe(2);
    expect(otaka?.incidents["目的地"]).toBe(22);
    expect(ponta?.playOrder).toBe(1);
    expect(ponta?.incidents["目的地"]).toBe(11);
    expect(akane?.playOrder).toBe(3);
    expect(akane?.incidents["目的地"]).toBe(33);
  });
});
