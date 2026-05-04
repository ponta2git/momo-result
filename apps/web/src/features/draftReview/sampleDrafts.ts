import type { OcrDraftResponse } from "@/features/draftReview/api";
import type { SlotKind } from "@/shared/api/enums";
import type { SlotMap } from "@/shared/lib/slotMap";

const now = "2026-01-01T00:00:00.000Z";

function field<T>(value: T, confidence = 0.96, warnings: string[] = []) {
  return {
    value,
    raw_text: value == null ? null : String(value),
    confidence,
    warnings,
  };
}

const players = [
  ["ぽんた", "member_ponta", 1, 1, 15420, 3220, [2, 8, 4, 6, 1, 0]],
  ["NO11社長", "member_akane_mami", 2, 2, 13210, 2890, [1, 7, 5, 5, 2, 1]],
  ["オータカ社長", "member_otaka", 3, 3, 11880, 2410, [0, 5, 6, 4, 3, 0]],
  ["いーゆー", "member_eu", 4, 4, 9800, 1990, [1, 4, 7, 3, 1, 2]],
] as const;

const incidentNames = [
  "目的地",
  "プラス駅",
  "マイナス駅",
  "カード駅",
  "カード売り場",
  "スリの銀次",
] as const;

function payload(kind: SlotKind) {
  return {
    requested_screen_type: kind,
    detected_screen_type: kind,
    profile_id: `dev.${kind}.sample`,
    players: players.map(
      ([rawName, memberId, playOrder, rank, assets, revenue, incidents], index) => ({
        raw_player_name: field(
          rawName,
          index === 1 ? 0.82 : 0.96,
          index === 1 ? ["既知エイリアスで解決"] : [],
        ),
        member_id: memberId,
        play_order: field(playOrder),
        rank: field(rank, index === 2 ? 0.78 : 0.95, index === 2 ? ["順位の視認性が低い"] : []),
        total_assets_man_yen: field(kind === "total_assets" ? assets : null),
        revenue_man_yen: field(kind === "revenue" ? revenue : null, index === 3 ? 0.72 : 0.94),
        incidents: Object.fromEntries(
          incidentNames.map((name, incidentIndex) => [
            name,
            field(kind === "incident_log" ? incidents[incidentIndex] : null),
          ]),
        ),
      }),
    ),
    category_payload: {},
    warnings: kind === "revenue" ? ["いーゆーの収益が低信頼度"] : [],
    raw_snippets: null,
  };
}

export function createSampleDraft(kind: SlotKind): OcrDraftResponse {
  return {
    draftId: `sample-${kind}`,
    jobId: `sample-job-${kind}`,
    requestedImageType: kind,
    detectedImageType: kind,
    profileId: `dev.${kind}.sample`,
    payloadJson: payload(kind),
    warningsJson: [],
    timingsMsJson: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function createSampleDraftMap(): SlotMap<OcrDraftResponse> {
  return {
    total_assets: createSampleDraft("total_assets"),
    revenue: createSampleDraft("revenue"),
    incident_log: createSampleDraft("incident_log"),
  };
}
