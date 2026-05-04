import { incidentNames, parseOcrDraftPayload } from "@/features/draftReview/ocrPayload";
import type {
  IncidentName,
  OcrDraftPayload,
  OcrField,
  OcrPlayerEntry,
} from "@/features/draftReview/ocrPayload";
import { fixedMembers } from "@/features/auth/members";
import type { components } from "@/shared/api/generated";
import { pipe } from "@/shared/lib/pipe";
import type { SlotMap } from "@/shared/lib/slotMap";

export type DraftByKind = SlotMap<components["schemas"]["OcrDraftResponse"]>;

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

function resolveMemberIdForRow(entry: OcrPlayerEntry | undefined, fallbackIndex: number): string {
  if (entry?.member_id && memberIds.includes(entry.member_id)) {
    return entry.member_id;
  }
  return aliasToMemberId(entry?.raw_player_name.value) ?? memberIds[fallbackIndex] ?? "";
}

/**
 * 各エントリから 1 件ずつ値を取り出すが、`pool` 内のユニークな値しか採用しないクレーム処理。
 * 採用されなかった行には、まだ誰にも使われていない `pool` の値を順に充当する。
 *
 * memberId / playOrder のように「重複させたくないが、欠けた行は fallback で埋めたい」共通パターン。
 */
function claimWithoutDuplicates<T, V>(
  entries: readonly T[],
  pool: readonly V[],
  claim: (entry: T) => V | undefined,
  fallbackEmpty: V,
): V[] {
  const used = new Set<V>();
  const initial: Array<V | undefined> = entries.map((entry) => {
    const value = claim(entry);
    if (value !== undefined && pool.includes(value) && !used.has(value)) {
      used.add(value);
      return value;
    }
    return undefined;
  });
  const remaining = pool.filter((value) => !used.has(value));
  return initial.map((value) => value ?? remaining.shift() ?? fallbackEmpty);
}

/**
 * 4人分の OCR エントリからエイリアス一致 → 固定メンバー順 (fallback) の順で
 * memberId を解決し、重複が出ないように未使用メンバーで埋める。
 */
function resolveMemberIds(entries: ReadonlyArray<OcrPlayerEntry | undefined>): string[] {
  return claimWithoutDuplicates(
    entries,
    memberIds,
    (entry) => {
      if (entry?.member_id && memberIds.includes(entry.member_id)) {
        return entry.member_id;
      }
      return aliasToMemberId(entry?.raw_player_name.value);
    },
    "",
  );
}

/**
 * OCR が play_order を検出した行はその値を尊重し、未検出 (または重複) の行には
 * 未使用の play_order (1〜4) を 1 から順に割り当てる。
 */
function resolvePlayOrders(entries: ReadonlyArray<OcrPlayerEntry | undefined>): number[] {
  return claimWithoutDuplicates(
    entries,
    [1, 2, 3, 4] as const,
    (entry) => {
      const value = entry?.play_order?.value;
      return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 4
        ? value
        : undefined;
    },
    0,
  );
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
    entries.set(resolveMemberIdForRow(entry, index), entry);
  });
  return entries;
}

function byPlayOrder(payload: OcrDraftPayload | undefined): Map<number, OcrPlayerEntry> {
  const entries = new Map<number, OcrPlayerEntry>();
  payload?.players.forEach((entry, index) => {
    const declared = entry.play_order?.value;
    const order = typeof declared === "number" && Number.isFinite(declared) ? declared : index + 1;
    if (!entries.has(order)) {
      entries.set(order, entry);
    }
  });
  return entries;
}

// ---------- pipeline stages (pure) ----------

type ParsedDrafts = {
  totalAssets: OcrDraftPayload | undefined;
  revenue: OcrDraftPayload | undefined;
  incidentLog: OcrDraftPayload | undefined;
};

function parseAll(drafts: DraftByKind): ParsedDrafts {
  return {
    totalAssets: parseDraft(drafts.total_assets),
    revenue: parseDraft(drafts.revenue),
    incidentLog: parseDraft(drafts.incident_log),
  };
}

function collectWarnings(parsed: ParsedDrafts): string[] {
  const warnings: string[] = [];
  if (!parsed.totalAssets)
    warnings.push("総資産の下書きがありません。順位と総資産は手入力してください。");
  if (!parsed.revenue) warnings.push("収益の下書きがありません。収益は手入力してください。");
  if (!parsed.incidentLog) warnings.push("事件簿の下書きがありません。事件簿は0で初期化しました。");
  return warnings;
}

function buildIncidentLookup(
  incidentLog: OcrDraftPayload | undefined,
): Map<number, IncidentLookupEntry> {
  const lookup = new Map<number, IncidentLookupEntry>();
  for (const [order, entry] of byPlayOrder(incidentLog)) {
    const counts = emptyIncidents();
    const confidence: Partial<Record<IncidentName, number | null>> = {};
    for (const name of incidentNames) {
      const field = entry.incidents[name];
      counts[name] = numberValue(field, 0);
      confidence[name] = field?.confidence ?? null;
    }
    lookup.set(order, { counts, confidence });
  }
  return lookup;
}

function buildPlayers(
  parsed: ParsedDrafts,
  incidentByPlayOrder: Map<number, IncidentLookupEntry>,
): ReviewPlayer[] {
  const sourcePlayers = parsed.totalAssets?.players.length
    ? parsed.totalAssets.players
    : fixedMembers.map(() => undefined);
  const trimmedSources = sourcePlayers.slice(0, 4);
  const resolvedMemberIds = resolveMemberIds(trimmedSources);
  const resolvedPlayOrders = resolvePlayOrders(trimmedSources);
  const revenueByMember = byMemberId(parsed.revenue);

  return trimmedSources.map((entry, index) => {
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
}

function padToFour(players: readonly ReviewPlayer[]): ReviewPlayer[] {
  if (players.length >= 4) {
    return [...players];
  }
  const usedMemberIds = new Set(players.map((player) => player.memberId));
  const padded: ReviewPlayer[] = [...players];
  for (const member of fixedMembers) {
    if (padded.length >= 4) {
      break;
    }
    if (usedMemberIds.has(member.memberId)) {
      continue;
    }
    const order = padded.length + 1;
    usedMemberIds.add(member.memberId);
    padded.push({
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
  return padded;
}

/**
 * 取り込み直後は総資産の降順で並べる。同額時は OCR が読み取った順位 → play_order を
 * 二次・三次キーにして安定化させる。
 */
function sortByAssetsDesc(players: readonly ReviewPlayer[]): ReviewPlayer[] {
  return players.toSorted((a, b) => {
    if (b.totalAssetsManYen !== a.totalAssetsManYen) {
      return b.totalAssetsManYen - a.totalAssetsManYen;
    }
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.playOrder - b.playOrder;
  });
}

/**
 * OCR 結果 (3 種類の下書き) を 1 つの review 用ビューに合成する純関数。
 *
 * パイプライン:
 *   parseAll → (warnings | incidentLookup | buildPlayers → padToFour → sortByAssetsDesc)
 *
 * 各段は独立した純関数で、入力に対する出力が一意 (参照透過)。
 */
export function mergeDrafts(drafts: DraftByKind): MergedDraftReview {
  const parsed = parseAll(drafts);
  const incidentByPlayOrder = buildIncidentLookup(parsed.incidentLog);
  const players = pipe(buildPlayers(parsed, incidentByPlayOrder), padToFour, sortByAssetsDesc);
  return {
    players,
    warnings: collectWarnings(parsed),
    incidentByPlayOrder,
  };
}
