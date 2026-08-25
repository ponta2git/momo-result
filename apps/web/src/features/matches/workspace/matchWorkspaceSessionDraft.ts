import { z } from "zod";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { fixedMemberIds } from "@/shared/domain/members";

const storagePrefix = "momoresult.matchWorkspaceDraft.v1.";
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
});

const sessionDraftSchema = z.object({
  acknowledgedCellIds: z.array(z.string()),
  baselineFingerprint: z.string(),
  savedAt: z.string(),
  values: matchFormValuesSchema,
  version: z.literal(1),
});

export type MatchWorkspaceSessionDraft = Omit<z.infer<typeof sessionDraftSchema>, "values"> & {
  values: MatchFormValues;
};

function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
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

export function matchWorkspaceSessionDraftKey(args: {
  mode: WorkspaceMode;
  workspaceKey: string;
}): string {
  return `${storagePrefix}${args.mode}.${encodeURIComponent(args.workspaceKey)}`;
}

export function parseMatchWorkspaceSessionDraft(raw: string): MatchWorkspaceSessionDraft | null {
  try {
    const parsed = sessionDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as MatchWorkspaceSessionDraft) : null;
  } catch {
    return null;
  }
}

export function loadMatchWorkspaceSessionDraft(key: string): MatchWorkspaceSessionDraft | null {
  const storage = sessionStorageOrNull();
  const raw = storage?.getItem(key);
  return raw ? parseMatchWorkspaceSessionDraft(raw) : null;
}

export function saveMatchWorkspaceSessionDraft(
  key: string,
  draft: MatchWorkspaceSessionDraft,
): boolean {
  const storage = sessionStorageOrNull();
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeMatchWorkspaceSessionDraft(key: string): void {
  try {
    sessionStorageOrNull()?.removeItem(key);
  } catch {
    // Storage cleanup is best effort; the form remains usable when storage is unavailable.
  }
}
