import { z } from "zod";

import { incidentDefinitions } from "@/shared/domain/incidents";
import type { IncidentCountsByKey } from "@/shared/domain/incidents";

const legacyHandoffStoragePrefix = "momoresult.masterHandoff.";
export const handoffStoragePrefix = "momoresult.masterHandoff.v2.";
export const handoffSchemaVersion = 2;
const handoffTtlMs = 2 * 60 * 60 * 1000;

const handoffSourceSchema = z.enum(["draftReview", "matchWorkspace"]);

const handoffIncidentsSchema = z.object({
  cardShop: z.number().int().min(0),
  cardStation: z.number().int().min(0),
  destination: z.number().int().min(0),
  minusStation: z.number().int().min(0),
  plusStation: z.number().int().min(0),
  suriNoGinji: z.number().int().min(0),
});

const handoffValuesSchema = z.object({
  draftIds: z.object({
    incidentLog: z.string().optional(),
    revenue: z.string().optional(),
    totalAssets: z.string().optional(),
  }),
  gameTitleId: z.string(),
  heldEventId: z.string(),
  mapMasterId: z.string(),
  matchNoInEvent: z.number().int().min(1),
  ownerMemberId: z.string(),
  playedAt: z.string(),
  players: z
    .array(
      z.object({
        incidents: handoffIncidentsSchema,
        memberId: z.string(),
        playOrder: z.number().int().min(1).max(4),
        rank: z.number().int().min(1).max(4),
        revenueManYen: z.number().int(),
        totalAssetsManYen: z.number().int(),
      }),
    )
    .length(4),
  seasonMasterId: z.string(),
});

const masterHandoffPayloadSchema = z.object({
  accountId: z.string().min(1),
  createdAt: z.string(),
  matchSessionId: z.string(),
  returnTo: z.string(),
  schemaVersion: z.literal(handoffSchemaVersion),
  source: handoffSourceSchema,
  values: handoffValuesSchema,
});

export type MatchWorkspaceHandoffValues = z.infer<typeof handoffValuesSchema>;
export type MatchWorkspaceMasterHandoffValues = MatchWorkspaceHandoffValues;
export type MasterHandoffPayload = z.infer<typeof masterHandoffPayloadSchema>;
export type MasterHandoffStorage = Pick<
  Storage,
  "getItem" | "key" | "length" | "removeItem" | "setItem"
>;

export type MasterHandoffSaveOptions = {
  createId?: () => string;
  storage?: MasterHandoffStorage;
};

export type MasterHandoffReadOptions = {
  storage?: MasterHandoffStorage;
};

function discardLegacyHandoffs(storage: MasterHandoffStorage): void {
  const legacyKeys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  ).filter((key): key is string =>
    Boolean(key?.startsWith(legacyHandoffStoragePrefix) && !key.startsWith(handoffStoragePrefix)),
  );
  for (const key of legacyKeys) {
    storage.removeItem(key);
  }
}

function pruneDraftIds(
  values: MatchWorkspaceHandoffValues["draftIds"],
): MatchWorkspaceHandoffValues["draftIds"] {
  const next: MatchWorkspaceHandoffValues["draftIds"] = {};
  if (values.totalAssets) next.totalAssets = values.totalAssets;
  if (values.revenue) next.revenue = values.revenue;
  if (values.incidentLog) next.incidentLog = values.incidentLog;
  return next;
}

function pickIncidents(incidents: IncidentCountsByKey): IncidentCountsByKey {
  return Object.fromEntries(
    incidentDefinitions.map((definition) => [definition.key, incidents[definition.key]]),
  ) as IncidentCountsByKey;
}

export function browserSessionStorage(): MasterHandoffStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const storage = window.sessionStorage;
    discardLegacyHandoffs(storage);
    return storage;
  } catch {
    return undefined;
  }
}

export function storageKey(accountId: string, handoffId: string): string {
  return `${handoffStoragePrefix}${encodeURIComponent(accountId)}.${handoffId}`;
}

export function parsePayload(raw: string): MasterHandoffPayload | undefined {
  try {
    return masterHandoffPayloadSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function isExpired(createdAt: string, nowMs: number): boolean {
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) {
    return true;
  }
  return nowMs - createdMs > handoffTtlMs;
}

export function createMatchWorkspaceHandoffPayload(input: {
  accountId: string;
  createdAt?: string;
  matchSessionId: string;
  returnTo: string;
  values: MatchWorkspaceHandoffValues;
}): MasterHandoffPayload {
  return {
    accountId: input.accountId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    matchSessionId: input.matchSessionId,
    returnTo: input.returnTo,
    schemaVersion: handoffSchemaVersion,
    source: "matchWorkspace",
    values: {
      draftIds: pruneDraftIds(input.values.draftIds),
      gameTitleId: input.values.gameTitleId,
      heldEventId: input.values.heldEventId,
      mapMasterId: input.values.mapMasterId,
      matchNoInEvent: input.values.matchNoInEvent,
      ownerMemberId: input.values.ownerMemberId,
      playedAt: input.values.playedAt,
      players: input.values.players.map((player) => ({
        incidents: pickIncidents(player.incidents),
        memberId: player.memberId,
        playOrder: player.playOrder,
        rank: player.rank,
        revenueManYen: player.revenueManYen,
        totalAssetsManYen: player.totalAssetsManYen,
      })),
      seasonMasterId: input.values.seasonMasterId,
    },
  };
}

export const createMatchWorkspaceMasterHandoffPayload = createMatchWorkspaceHandoffPayload;
