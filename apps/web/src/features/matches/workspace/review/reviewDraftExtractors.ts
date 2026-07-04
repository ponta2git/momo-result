import type {
  DraftByKind,
  ReviewIncidentCounts,
} from "@/features/matches/workspace/matchFormTypes";
import {
  incidentNames,
  parseOcrDraftPayload,
} from "@/features/matches/workspace/review/ocrDraftPayload";
import type {
  IncidentName,
  OcrDraftPayload,
  OcrField,
  OcrPlayerEntry,
} from "@/features/matches/workspace/review/ocrDraftPayload";
import { resolveMemberIdByAlias } from "@/shared/domain/memberDirectory";
import type { MemberAliasDirectory } from "@/shared/domain/memberDirectory";

export function emptyIncidents(): ReviewIncidentCounts {
  return Object.fromEntries(incidentNames.map((name) => [name, 0])) as ReviewIncidentCounts;
}

export function resolveMemberIdForRow(
  directory: MemberAliasDirectory,
  entry: OcrPlayerEntry | undefined,
  fallbackIndex: number,
): string {
  const memberIds = directory.memberIds;
  if (entry?.member_id && memberIds.includes(entry.member_id)) {
    return entry.member_id;
  }
  return (
    resolveMemberIdByAlias(directory, entry?.raw_player_name.value) ??
    memberIds[fallbackIndex] ??
    ""
  );
}

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

export function resolveMemberIds(
  entries: ReadonlyArray<OcrPlayerEntry | undefined>,
  directory: MemberAliasDirectory,
): string[] {
  return claimWithoutDuplicates(
    entries,
    directory.memberIds,
    (entry) => {
      if (entry?.member_id && directory.memberIds.includes(entry.member_id)) {
        return entry.member_id;
      }
      return resolveMemberIdByAlias(directory, entry?.raw_player_name.value);
    },
    "",
  );
}

export function resolvePlayOrders(entries: ReadonlyArray<OcrPlayerEntry | undefined>): number[] {
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

export function numberValue(field: OcrField<number> | undefined, fallback: number): number {
  const value = field?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseDraft(
  draft: DraftByKind["total_assets"] | undefined,
): OcrDraftPayload | undefined {
  if (!draft) {
    return undefined;
  }
  return parseOcrDraftPayload(draft.payloadJson);
}

export function byMemberId(
  payload: OcrDraftPayload | undefined,
  directory: MemberAliasDirectory,
): { entries: Map<string, OcrPlayerEntry>; warnings: string[] } {
  const entries = new Map<string, OcrPlayerEntry>();
  const warnings: string[] = [];
  payload?.players.forEach((entry, index) => {
    const memberId = resolveMemberIdForRow(directory, entry, index);
    if (!memberId) {
      return;
    }
    if (entries.has(memberId)) {
      warnings.push(
        `収益の読み取り結果で ${memberId} に解決される行が複数あります。最初の行を採用しました。`,
      );
      return;
    }
    entries.set(memberId, entry);
  });
  return { entries, warnings };
}

export function byPlayOrder(payload: OcrDraftPayload | undefined): Map<number, OcrPlayerEntry> {
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

export type { IncidentName, OcrDraftPayload };
