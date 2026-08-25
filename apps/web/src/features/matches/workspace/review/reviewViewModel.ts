import type {
  DraftByKind,
  IncidentLookupEntry,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import {
  incidentNames,
  parseOcrWarningList,
} from "@/features/matches/workspace/review/ocrDraftPayload";
import {
  byPlayOrder,
  emptyIncidents,
  numberValue,
  parseDraft,
} from "@/features/matches/workspace/review/reviewDraftExtractors";
import type {
  IncidentName,
  OcrDraftPayload,
  OcrWarning,
} from "@/features/matches/workspace/review/reviewDraftExtractors";
import { buildReviewPlayers } from "@/features/matches/workspace/review/reviewPlayerBuilder";
import {
  buildFieldEvidence,
  dedupeOcrWarnings,
  reviewWarningMessage,
} from "@/features/matches/workspace/review/reviewWarningModel";
import { defaultMemberAliasDirectory } from "@/shared/domain/memberDirectory";
import type { MemberAliasDirectory } from "@/shared/domain/memberDirectory";
import { workspaceInputMembers } from "@/shared/domain/members";
import { pipe } from "@/shared/lib/pipe";

export type ReviewPlayer = OriginalPlayerSnapshot;
type ReviewFieldEvidence = ReturnType<typeof buildFieldEvidence>;

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
  totalAssets: ParsedReviewDraft | undefined;
  revenue: ParsedReviewDraft | undefined;
  incidentLog: ParsedReviewDraft | undefined;
};

type ParsedReviewDraft = {
  payload: OcrDraftPayload;
  warnings: OcrWarning[];
};

function parseReviewDraft(draft: DraftByKind[keyof DraftByKind]): ParsedReviewDraft | undefined {
  const payload = parseDraft(draft);
  if (!draft || !payload) {
    return undefined;
  }
  return {
    payload,
    warnings: dedupeOcrWarnings([...payload.warnings, ...parseOcrWarningList(draft.warningsJson)]),
  };
}

function parseAll(drafts: DraftByKind): ParsedDrafts {
  return {
    totalAssets: parseReviewDraft(drafts.total_assets),
    revenue: parseReviewDraft(drafts.revenue),
    incidentLog: parseReviewDraft(drafts.incident_log),
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
  incidentLog: ParsedReviewDraft | undefined,
  attachedWarnings: Set<OcrWarning>,
): Map<number, IncidentLookupEntry> {
  const lookup = new Map<number, IncidentLookupEntry>();
  for (const [order, entry] of byPlayOrder(incidentLog?.payload)) {
    const counts = emptyIncidents();
    const confidence: Partial<Record<IncidentName, number | null>> = {};
    const evidence: Partial<Record<IncidentName, ReviewFieldEvidence>> = {};
    const playerIndex = incidentLog?.payload.players.indexOf(entry) ?? -1;
    for (const name of incidentNames) {
      const field = entry.incidents[name];
      counts[name] = numberValue(field, 0);
      confidence[name] = field?.confidence ?? null;
      if (incidentLog && playerIndex >= 0) {
        evidence[name] = buildFieldEvidence({
          attachedWarnings,
          confidence: field?.confidence,
          embeddedWarnings: field?.warnings,
          fieldNames: [`incidents.${name}`],
          playerIndex,
          sourceKind: "incident_log",
          warnings: incidentLog.warnings,
        });
      }
    }
    lookup.set(order, { counts, confidence, evidence });
  }
  return lookup;
}

function padToFour(players: readonly ReviewPlayer[]): ReviewPlayer[] {
  if (players.length >= 4) {
    return [...players];
  }
  const usedMemberIds = new Set(players.map((player) => player.memberId));
  const padded: ReviewPlayer[] = [...players];
  for (const member of workspaceInputMembers) {
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
      evidence: { incidents: {} },
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
  const attachedWarnings = new Set<OcrWarning>();
  const incidentByPlayOrder = buildIncidentLookup(parsed.incidentLog, attachedWarnings);
  const builtPlayers = buildReviewPlayers(
    parsed,
    incidentByPlayOrder,
    memberDirectory,
    attachedWarnings,
  );
  const players = pipe(builtPlayers.players, padToFour, sortByAssetsDesc);
  const unattachedWarnings = [parsed.totalAssets, parsed.revenue, parsed.incidentLog]
    .flatMap((draft) => draft?.warnings ?? [])
    .filter((warning) => !attachedWarnings.has(warning))
    .map(reviewWarningMessage);
  return {
    players,
    warnings: [
      ...new Set([...collectWarnings(parsed), ...builtPlayers.warnings, ...unattachedWarnings]),
    ],
    incidentByPlayOrder,
  };
}
