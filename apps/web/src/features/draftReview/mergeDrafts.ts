import type { components } from "@/shared/api/generated";
import { fixedMembers } from "@/features/ocrCapture/localMasters";
import type { SlotKind } from "@/shared/api/enums";
import { incidentNames, parseOcrDraftPayload } from "@/features/draftReview/ocrPayload";
import type {
  IncidentName,
  OcrDraftPayload,
  OcrField,
  OcrPlayerEntry,
} from "@/features/draftReview/ocrPayload";

export type DraftByKind = Partial<Record<SlotKind, components["schemas"]["OcrDraftResponse"]>>;

export type ReviewIncidentCounts = Record<IncidentName, number>;

export type ReviewPlayer = {
  memberId: string;
  playOrder: number;
  rank: number;
  totalAssetsManYen: number;
  revenueManYen: number;
  incidents: ReviewIncidentCounts;
  rawPlayerName?: string | undefined;
  warnings: string[];
  confidence: {
    rank?: number | null;
    totalAssets?: number | null;
    revenue?: number | null;
    incidents: Partial<Record<IncidentName, number | null>>;
  };
};

export type MergedDraftReview = {
  players: ReviewPlayer[];
  warnings: string[];
};

const memberIds = fixedMembers.map((member) => member.memberId);

function emptyIncidents(): ReviewIncidentCounts {
  return Object.fromEntries(incidentNames.map((name) => [name, 0])) as ReviewIncidentCounts;
}

function aliasToMemberId(rawName: string | null | undefined): string | undefined {
  if (!rawName) {
    return undefined;
  }
  const normalized = rawName.trim();
  return fixedMembers.find((member) =>
    [member.displayName, ...member.aliases].some((alias) => alias === normalized),
  )?.memberId;
}

function memberIdFor(entry: OcrPlayerEntry | undefined, fallbackIndex: number): string {
  if (entry?.member_id && memberIds.includes(entry.member_id)) {
    return entry.member_id;
  }
  return aliasToMemberId(entry?.raw_player_name.value) ?? memberIds[fallbackIndex] ?? "";
}

function numberValue(field: OcrField<number> | undefined, fallback: number): number {
  const value = field?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseDraft(
  draft: components["schemas"]["OcrDraftResponse"] | undefined,
): OcrDraftPayload | undefined {
  if (!draft) {
    return undefined;
  }
  return parseOcrDraftPayload(draft.payloadJson);
}

function byMemberId(payload: OcrDraftPayload | undefined): Map<string, OcrPlayerEntry> {
  const entries = new Map<string, OcrPlayerEntry>();
  payload?.players.forEach((entry, index) => {
    entries.set(memberIdFor(entry, index), entry);
  });
  return entries;
}

export function mergeDrafts(drafts: DraftByKind): MergedDraftReview {
  const totalAssets = parseDraft(drafts.total_assets);
  const revenue = parseDraft(drafts.revenue);
  const incidentLog = parseDraft(drafts.incident_log);
  const revenueByMember = byMemberId(revenue);
  const incidentsByMember = byMemberId(incidentLog);
  const sourcePlayers = totalAssets?.players.length
    ? totalAssets.players
    : fixedMembers.map(() => undefined);
  const warnings: string[] = [];

  if (!totalAssets) warnings.push("総資産の下書きがありません。順位と総資産は手入力してください。");
  if (!revenue) warnings.push("収益の下書きがありません。収益は手入力してください。");
  if (!incidentLog) warnings.push("事件簿の下書きがありません。事件簿は0で初期化しました。");

  const players = sourcePlayers.slice(0, 4).map((entry, index) => {
    const memberId = memberIdFor(entry, index);
    const revenueEntry = revenueByMember.get(memberId);
    const incidentEntry = incidentsByMember.get(memberId);
    const incidents = emptyIncidents();
    const incidentConfidence: Partial<Record<IncidentName, number | null>> = {};

    for (const name of incidentNames) {
      const field = incidentEntry?.incidents[name];
      incidents[name] = numberValue(field, 0);
      incidentConfidence[name] = field?.confidence ?? null;
    }

    const playerWarnings = [
      ...(entry?.raw_player_name.warnings ?? []),
      ...(entry?.rank.warnings ?? []),
      ...(entry?.total_assets_man_yen.warnings ?? []),
      ...(revenueEntry?.revenue_man_yen.warnings ?? []),
    ];

    return {
      memberId,
      playOrder: numberValue(entry?.play_order, index + 1),
      rank: numberValue(entry?.rank, index + 1),
      totalAssetsManYen: numberValue(entry?.total_assets_man_yen, 0),
      revenueManYen: numberValue(revenueEntry?.revenue_man_yen, 0),
      incidents,
      rawPlayerName: entry?.raw_player_name.value ?? undefined,
      warnings: playerWarnings,
      confidence: {
        rank: entry?.rank.confidence ?? null,
        totalAssets: entry?.total_assets_man_yen.confidence ?? null,
        revenue: revenueEntry?.revenue_man_yen.confidence ?? null,
        incidents: incidentConfidence,
      },
    };
  });

  const usedMemberIds = new Set(players.map((player) => player.memberId));
  for (const member of fixedMembers) {
    if (players.length >= 4) {
      break;
    }
    if (usedMemberIds.has(member.memberId)) {
      continue;
    }
    const order = players.length + 1;
    players.push({
      memberId: member.memberId,
      playOrder: order,
      rank: order,
      totalAssetsManYen: 0,
      revenueManYen: 0,
      incidents: emptyIncidents(),
      rawPlayerName: undefined,
      warnings: [],
      confidence: { rank: null, totalAssets: null, revenue: null, incidents: {} },
    });
  }

  return { players, warnings };
}
