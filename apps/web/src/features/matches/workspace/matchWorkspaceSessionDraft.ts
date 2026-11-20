import { _default as withDefault, z } from "zod/mini";

import { matchAchievementSelectionSchema } from "@/features/matches/workspace/matchAchievementSelection";
import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { fixedMemberIds } from "@/shared/domain/members";

const legacyStoragePrefix = "momoresult.matchWorkspaceDraft.v1.";
const storagePrefix = "momoresult.matchWorkspaceDraft.v2.";
export const matchWorkspaceSessionDraftTtlMs = 2 * 60 * 60 * 1000;
const memberId = z.enum(fixedMemberIds);

const incidentSchema = z.object({
  cardShop: z.number(),
  cardStation: z.number(),
  destination: z.number(),
  minusStation: z.number(),
  plusStation: z.number(),
  suriNoGinji: z.number(),
});

const matchFormValuesSchema = z.object({
  draftIds: z.object({
    incidentLog: z.optional(z.string()),
    revenue: z.optional(z.string()),
    totalAssets: z.optional(z.string()),
  }),
  gameTitleId: z.string(),
  heldEventId: z.string(),
  mapMasterId: z.string(),
  matchDraftId: z.optional(z.string()),
  matchNoInEvent: z.number(),
  ownerMemberId: memberId,
  playedAt: z.string(),
  achievements: withDefault(z.array(matchAchievementSelectionSchema), []),
  expectedVersion: z.optional(z.string()),
  initialResultFingerprint: z.optional(z.string()),
  players: z
    .array(
      z.object({
        incidents: incidentSchema,
        memberId,
        playOrder: z.number(),
        rank: z.number(),
        revenueManYen: z.number(),
        totalAssetsManYen: z.number(),
      }),
    )
    .check(z.length(4)),
  seasonMasterId: z.string(),
  noteBody: withDefault(z.string(), ""),
  numericDrafts: z.optional(z.record(z.string(), z.string())),
});

const sessionDraftSchema = z.object({
  accountId: z.string().check(z.minLength(1)),
  acknowledgedCellIds: z.array(z.string()),
  baselineFingerprint: z.string(),
  resumeAutomatically: z.optional(z.boolean()),
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
