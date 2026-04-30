import { describe, expect, it } from "vitest";
import { mergeDrafts } from "@/features/draftReview/mergeDrafts";
import type { OcrDraftResponse } from "@/features/draftReview/api";

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
});
