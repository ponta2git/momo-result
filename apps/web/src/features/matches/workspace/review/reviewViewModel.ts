import type {
  DraftByKind,
  IncidentLookupEntry,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import { incidentNames } from "@/features/matches/workspace/review/ocrDraftPayload";
import {
  byMemberId,
  byPlayOrder,
  emptyIncidents,
  numberValue,
  parseDraft,
  resolveMemberIds,
  resolvePlayOrders,
} from "@/features/matches/workspace/review/reviewDraftExtractors";
import type {
  IncidentName,
  OcrDraftPayload,
} from "@/features/matches/workspace/review/reviewDraftExtractors";
import { defaultMemberAliasDirectory } from "@/shared/domain/memberDirectory";
import type { MemberAliasDirectory } from "@/shared/domain/memberDirectory";
import { fixedMembers } from "@/shared/domain/members";
import { pipe } from "@/shared/lib/pipe";

export type ReviewPlayer = OriginalPlayerSnapshot;

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
    warnings.push("総資産の読み取り結果がありません。順位と総資産は手入力してください。");
  if (!parsed.revenue) warnings.push("収益の読み取り結果がありません。収益は手入力してください。");
  if (!parsed.incidentLog)
    warnings.push("事件簿の読み取り結果がありません。事件簿は0で初期化しました。");
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
  directory: MemberAliasDirectory,
): { players: ReviewPlayer[]; warnings: string[] } {
  const memberIds = directory.memberIds;
  const sourcePlayers = parsed.totalAssets?.players.length
    ? parsed.totalAssets.players
    : fixedMembers.map(() => undefined);
  const trimmedSources = sourcePlayers.slice(0, 4);
  const resolvedMemberIds = resolveMemberIds(trimmedSources, directory);
  const resolvedPlayOrders = resolvePlayOrders(trimmedSources);
  const revenueByMember = byMemberId(parsed.revenue, directory);

  const players = trimmedSources.map((entry, index) => {
    const memberId = resolvedMemberIds[index] ?? memberIds[index] ?? "";
    const revenueEntry = revenueByMember.entries.get(memberId);
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
  return { players, warnings: revenueByMember.warnings };
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
export function mergeDrafts(
  drafts: DraftByKind,
  memberDirectory: MemberAliasDirectory = defaultMemberAliasDirectory,
): MergedDraftReview {
  const parsed = parseAll(drafts);
  const incidentByPlayOrder = buildIncidentLookup(parsed.incidentLog);
  const builtPlayers = buildPlayers(parsed, incidentByPlayOrder, memberDirectory);
  const players = pipe(builtPlayers.players, padToFour, sortByAssetsDesc);
  return {
    players,
    warnings: [...collectWarnings(parsed), ...builtPlayers.warnings],
    incidentByPlayOrder,
  };
}
