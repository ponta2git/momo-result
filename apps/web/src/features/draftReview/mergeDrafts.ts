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

export type IncidentLookupEntry = {
  counts: ReviewIncidentCounts;
  confidence: Partial<Record<IncidentName, number | null>>;
};

export type MergedDraftReview = {
  players: ReviewPlayer[];
  warnings: string[];
  /**
   * play_order (1〜4) をキーにした事件簿ルックアップ。
   * 事件簿画面は列位置 = play_order なので、ユーザーが play_order を変更したら
   * 該当行の事件数値に追従させるために UI 側で参照する。
   */
  incidentByPlayOrder: Map<number, IncidentLookupEntry>;
};

const memberIds = fixedMembers.map((member) => member.memberId);

function emptyIncidents(): ReviewIncidentCounts {
  return Object.fromEntries(incidentNames.map((name) => [name, 0])) as ReviewIncidentCounts;
}

function stripPresidentSuffix(name: string): string {
  return name.replace(/社長\s*$/u, "").trim();
}

function aliasToMemberId(rawName: string | null | undefined): string | undefined {
  if (!rawName) {
    return undefined;
  }
  const normalized = stripPresidentSuffix(rawName.trim());
  if (!normalized) {
    return undefined;
  }
  return fixedMembers.find((member) =>
    [member.displayName, ...member.aliases]
      .map((alias) => stripPresidentSuffix(alias.trim()))
      .some((alias) => alias === normalized),
  )?.memberId;
}

function memberIdFor(entry: OcrPlayerEntry | undefined, fallbackIndex: number): string {
  if (entry?.member_id && memberIds.includes(entry.member_id)) {
    return entry.member_id;
  }
  return aliasToMemberId(entry?.raw_player_name.value) ?? memberIds[fallbackIndex] ?? "";
}

/**
 * 4人分の OCR エントリからエイリアス一致 → 固定メンバー順 (fallback) の順で
 * memberId を解決し、重複が出ないように未使用メンバーで埋める。
 *
 * `memberIdFor` 単体ではエイリアスにマッチしなかった行と、別の行のフォールバック
 * 先（fixedMembers[index]）が衝突して同じメンバーが2回現れる問題を防ぐ。
 */
function resolveMemberIds(entries: (OcrPlayerEntry | undefined)[]): string[] {
  const resolved: (string | undefined)[] = entries.map((entry) => {
    if (entry?.member_id && memberIds.includes(entry.member_id)) {
      return entry.member_id;
    }
    return aliasToMemberId(entry?.raw_player_name.value);
  });

  const used = new Set(resolved.filter((id): id is string => Boolean(id)));
  const remaining = memberIds.filter((id) => !used.has(id));

  return resolved.map((id) => {
    if (id) {
      return id;
    }
    const next = remaining.shift();
    if (next) {
      used.add(next);
      return next;
    }
    return "";
  });
}

function resolvePlayOrders(entries: (OcrPlayerEntry | undefined)[]): number[] {
  // OCR が play_order を検出した行はその値を尊重し、未検出 (または重複) の行には
  // 未使用の play_order (1〜4) を 1 から順に割り当てる。
  // 単純な `index + 1` フォールバックだと、別行で OCR が読み取った play_order と
  // 衝突して同一の事件簿行を参照する不具合が起きるため。
  const used = new Set<number>();
  const claimed: (number | undefined)[] = entries.map((entry) => {
    const value = entry?.play_order?.value;
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 1 &&
      value <= 4 &&
      !used.has(value)
    ) {
      used.add(value);
      return value;
    }
    return undefined;
  });
  const remaining: number[] = [1, 2, 3, 4].filter((order) => !used.has(order));
  return claimed.map((value) => value ?? remaining.shift() ?? 0);
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

function byPlayOrder(payload: OcrDraftPayload | undefined): Map<number, OcrPlayerEntry> {
  const entries = new Map<number, OcrPlayerEntry>();
  payload?.players.forEach((entry, index) => {
    const declared = entry.play_order?.value;
    const order =
      typeof declared === "number" && Number.isFinite(declared) ? declared : index + 1;
    if (!entries.has(order)) {
      entries.set(order, entry);
    }
  });
  return entries;
}

export function mergeDrafts(drafts: DraftByKind): MergedDraftReview {
  const totalAssets = parseDraft(drafts.total_assets);
  const revenue = parseDraft(drafts.revenue);
  const incidentLog = parseDraft(drafts.incident_log);
  const revenueByMember = byMemberId(revenue);
  // incident_log は列位置 (play_order) で並ぶ画面なので、member_id ではなく play_order で照合する。
  // OCR が member 名を解決できなかった場合のフォールバック (fixedMembers[index]) で
  // 別人に事件簿数値が紐づく問題を避けるため。
  const incidentsByPlayOrder = byPlayOrder(incidentLog);
  const incidentByPlayOrder = new Map<number, IncidentLookupEntry>();
  for (const [order, entry] of incidentsByPlayOrder) {
    const counts = emptyIncidents();
    const confidence: Partial<Record<IncidentName, number | null>> = {};
    for (const name of incidentNames) {
      const field = entry.incidents[name];
      counts[name] = numberValue(field, 0);
      confidence[name] = field?.confidence ?? null;
    }
    incidentByPlayOrder.set(order, { counts, confidence });
  }
  const sourcePlayers = totalAssets?.players.length
    ? totalAssets.players
    : fixedMembers.map(() => undefined);
  const warnings: string[] = [];

  if (!totalAssets) warnings.push("総資産の下書きがありません。順位と総資産は手入力してください。");
  if (!revenue) warnings.push("収益の下書きがありません。収益は手入力してください。");
  if (!incidentLog) warnings.push("事件簿の下書きがありません。事件簿は0で初期化しました。");

  const trimmedSources = sourcePlayers.slice(0, 4);
  const resolvedMemberIds = resolveMemberIds(trimmedSources);
  const resolvedPlayOrders = resolvePlayOrders(trimmedSources);

  const players = trimmedSources.map((entry, index) => {
    const memberId = resolvedMemberIds[index] ?? memberIds[index] ?? "";
    const revenueEntry = revenueByMember.get(memberId);
    const playOrder = resolvedPlayOrders[index] ?? index + 1;
    const incidentLookup = incidentByPlayOrder.get(playOrder);
    const incidents = incidentLookup ? { ...incidentLookup.counts } : emptyIncidents();
    const incidentConfidence: Partial<Record<IncidentName, number | null>> = incidentLookup
      ? { ...incidentLookup.confidence }
      : {};

    const playerWarnings = [
      ...(entry?.raw_player_name.warnings ?? []),
      ...(entry?.rank.warnings ?? []),
      ...(entry?.total_assets_man_yen.warnings ?? []),
      ...(revenueEntry?.revenue_man_yen.warnings ?? []),
    ];

    return {
      memberId,
      playOrder,
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

  // 取り込み直後は総資産の降順で並べる。同額時は OCR が読み取った順位 → play_order を
  // 二次・三次キーにして安定化させる。
  players.sort((a, b) => {
    if (b.totalAssetsManYen !== a.totalAssetsManYen) {
      return b.totalAssetsManYen - a.totalAssetsManYen;
    }
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.playOrder - b.playOrder;
  });

  return { players, warnings, incidentByPlayOrder };
}
