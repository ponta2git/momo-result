import { z } from "zod";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { fixedMemberIds } from "@/shared/domain/members";

const legacyStoragePrefix = "momoresult.matchWorkspaceDraft.v1.";
const storagePrefix = "momoresult.matchWorkspaceDraft.v2.";
export const matchWorkspaceSessionDraftTtlMs = 2 * 60 * 60 * 1000;
const memberIds = [...fixedMemberIds] as [string, ...string[]];

const incidentSchema = z.object({
  cardShop: z.number().finite(),
  cardStation: z.number().finite(),
  destination: z.number().finite(),
  minusStation: z.number().finite(),
  plusStation: z.number().finite(),
  suriNoGinji: z.number().finite(),
});

const matchFormValuesSchema = z.object({
  draftIds: z.object({
    incidentLog: z.string().optional(),
    revenue: z.string().optional(),
    totalAssets: z.string().optional(),
  }),
  gameTitleId: z.string(),
  heldEventId: z.string(),
  mapMasterId: z.string(),
  matchDraftId: z.string().optional(),
  matchNoInEvent: z.number().finite(),
  ownerMemberId: z.enum(memberIds),
  playedAt: z.string(),
  players: z
    .array(
      z.object({
        incidents: incidentSchema,
        memberId: z.enum(memberIds),
        playOrder: z.number().finite(),
        rank: z.number().finite(),
        revenueManYen: z.number().finite(),
        totalAssetsManYen: z.number().finite(),
      }),
    )
    .length(4),
  seasonMasterId: z.string(),
  noteBody: z.string().default(""),
  numericDrafts: z.record(z.string(), z.string()).optional(),
});

const sessionDraftSchema = z.object({
  accountId: z.string().min(1),
  acknowledgedCellIds: z.array(z.string()),
  baselineFingerprint: z.string(),
  resumeAutomatically: z.boolean().optional(),
  savedAt: z.string(),
  values: matchFormValuesSchema,
  version: z.literal(2),
});

export type MatchWorkspaceSessionDraft = Omit<z.infer<typeof sessionDraftSchema>, "values"> & {
  values: MatchFormValues;
};

export type MatchWorkspaceSessionDraftScope = {
  accountId: string;
  mode: WorkspaceMode;
  workspaceKey: string;
};

function discardLegacySessionDrafts(storage: Storage): void {
  const legacyKeys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  ).filter((key): key is string => Boolean(key?.startsWith(legacyStoragePrefix)));
  for (const key of legacyKeys) {
    storage.removeItem(key);
  }
}

function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const storage = window.sessionStorage;
    discardLegacySessionDrafts(storage);
    return storage;
  } catch {
    return null;
  }
}

function normalizeBaseline(values: MatchFormValues, mode: WorkspaceMode): MatchFormValues {
  if (mode === "edit" || values.matchDraftId) {
    return values;
  }
  return { ...values, playedAt: "" };
}

export function matchWorkspaceValuesFingerprint(
  values: MatchFormValues,
  mode: WorkspaceMode,
): string {
  return JSON.stringify(normalizeBaseline(values, mode));
}

export function matchWorkspaceDraftFingerprint(args: {
  acknowledgedCellIds: readonly string[];
  mode: WorkspaceMode;
  values: MatchFormValues;
}): string {
  return JSON.stringify({
    acknowledgedCellIds: [...args.acknowledgedCellIds].toSorted(),
    values: args.values,
  });
}

export function matchWorkspaceSessionDraftKey(scope: MatchWorkspaceSessionDraftScope): string {
  return `${storagePrefix}${encodeURIComponent(scope.accountId)}.${scope.mode}.${encodeURIComponent(scope.workspaceKey)}`;
}

export function parseMatchWorkspaceSessionDraft(
  raw: string,
  expectedAccountId: string,
  now: number = Date.now(),
): MatchWorkspaceSessionDraft | null {
  try {
    const parsed = sessionDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.accountId !== expectedAccountId) return null;
    const savedAt = Date.parse(parsed.data.savedAt);
    const age = now - savedAt;
    return Number.isFinite(savedAt) && age >= 0 && age <= matchWorkspaceSessionDraftTtlMs
      ? (parsed.data as MatchWorkspaceSessionDraft)
      : null;
  } catch {
    return null;
  }
}

export function loadMatchWorkspaceSessionDraft(
  scope: MatchWorkspaceSessionDraftScope,
): MatchWorkspaceSessionDraft | null {
  try {
    const storage = sessionStorageOrNull();
    const key = matchWorkspaceSessionDraftKey(scope);
    const raw = storage?.getItem(key);
    const draft = raw ? parseMatchWorkspaceSessionDraft(raw, scope.accountId) : null;
    if (raw && !draft) storage?.removeItem(key);
    return draft;
  } catch {
    return null;
  }
}

export function saveMatchWorkspaceSessionDraft(
  scope: MatchWorkspaceSessionDraftScope,
  draft: MatchWorkspaceSessionDraft,
): boolean {
  const storage = sessionStorageOrNull();
  const parsed = sessionDraftSchema.safeParse(draft);
  if (!storage || !parsed.success || parsed.data.accountId !== scope.accountId) {
    return false;
  }
  try {
    const key = matchWorkspaceSessionDraftKey(scope);
    const serialized = JSON.stringify(parsed.data);
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

export function removeMatchWorkspaceSessionDraft(scope: MatchWorkspaceSessionDraftScope): void {
  try {
    sessionStorageOrNull()?.removeItem(matchWorkspaceSessionDraftKey(scope));
  } catch {
    // Storage cleanup is best effort; the form remains usable when storage is unavailable.
  }
}
