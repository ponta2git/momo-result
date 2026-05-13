import { z } from "zod";

import { incidentDefinitions } from "@/shared/domain/incidents";
import type { IncidentCountsByKey } from "@/shared/domain/incidents";

const handoffStoragePrefix = "momoresult.masterHandoff.";
const handoffSchemaVersion = 1;
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

function pickIncidents(incidents: IncidentCountsByKey): IncidentCountsByKey {
  return Object.fromEntries(
    incidentDefinitions.map((definition) => [definition.key, incidents[definition.key]]),
  ) as IncidentCountsByKey;
}

export type HandoffInspectResult =
  | { status: "available" }
  | { status: "expired" }
  | { status: "invalid" }
  | { status: "missing" };

export function sanitizeReturnTo(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  try {
    const parsed = new URL(value, "https://momo-result.local");
    if (parsed.origin !== "https://momo-result.local") {
      return undefined;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

export function buildMasterRoute(returnTo: string, handoffId?: string): string {
  const params = new URLSearchParams();
  params.set("returnTo", returnTo);
  if (handoffId) {
    params.set("handoffId", handoffId);
  }
  return `/admin/masters?${params.toString()}`;
}

export function appendHandoffIdToReturnTo(returnTo: string, handoffId: string): string {
  const base = new URL(returnTo, "https://momo-result.local");
  base.searchParams.set("handoffId", handoffId);
  return `${base.pathname}${base.search}${base.hash}`;
}

function randomHandoffId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function storageKey(handoffId: string): string {
  return `${handoffStoragePrefix}${handoffId}`;
}

function parsePayload(raw: string): MasterHandoffPayload | undefined {
  try {
    return masterHandoffPayloadSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function isExpired(createdAt: string, nowMs: number): boolean {
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) {
    return true;
  }
  return nowMs - createdMs > handoffTtlMs;
}

export function createMatchWorkspaceHandoffPayload(input: {
  matchSessionId: string;
  returnTo: string;
  values: MatchWorkspaceHandoffValues;
}): MasterHandoffPayload {
  return {
    createdAt: new Date().toISOString(),
    matchSessionId: input.matchSessionId,
    returnTo: input.returnTo,
    schemaVersion: handoffSchemaVersion,
    source: "matchWorkspace",
    values: {
      draftIds: {
        incidentLog: input.values.draftIds.incidentLog,
        revenue: input.values.draftIds.revenue,
        totalAssets: input.values.draftIds.totalAssets,
      },
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

export function saveMasterHandoff(payload: MasterHandoffPayload): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const handoffId = randomHandoffId();
    window.sessionStorage.setItem(storageKey(handoffId), JSON.stringify(payload));
    return handoffId;
  } catch {
    return undefined;
  }
}

export type MatchWorkspaceMasterHandoffRouteResult =
  | { handoffId: string; route: string; status: "available" }
  | { reason: "storage_unavailable"; status: "unavailable" };

export function prepareMatchWorkspaceMasterHandoffRoute(input: {
  matchSessionId: string;
  returnTo: string;
  values: MatchWorkspaceHandoffValues;
}): MatchWorkspaceMasterHandoffRouteResult {
  const payload = createMatchWorkspaceMasterHandoffPayload(input);
  const handoffId = saveMasterHandoff(payload);
  if (!handoffId) {
    return { reason: "storage_unavailable", status: "unavailable" };
  }
  return {
    handoffId,
    route: buildMasterRoute(input.returnTo, handoffId),
    status: "available",
  };
}

export function inspectMasterHandoff(input: {
  expectedMatchSessionId?: string | undefined;
  expectedReturnTo: string;
  handoffId: string | null | undefined;
  nowMs?: number;
}): HandoffInspectResult {
  if (!input.handoffId || typeof window === "undefined") {
    return { status: "missing" };
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey(input.handoffId));
    if (!raw) {
      return { status: "missing" };
    }
    const payload = parsePayload(raw);
    if (!payload) {
      return { status: "invalid" };
    }
    if (sanitizeReturnTo(payload.returnTo) !== sanitizeReturnTo(input.expectedReturnTo)) {
      return { status: "invalid" };
    }
    if (
      input.expectedMatchSessionId !== undefined &&
      payload.matchSessionId !== input.expectedMatchSessionId
    ) {
      return { status: "invalid" };
    }
    if (isExpired(payload.createdAt, input.nowMs ?? Date.now())) {
      return { status: "expired" };
    }
    return { status: "available" };
  } catch {
    return { status: "invalid" };
  }
}

export function loadMasterHandoff(input: {
  expectedMatchSessionId?: string | undefined;
  expectedReturnTo: string;
  handoffId: string | null | undefined;
  nowMs?: number;
}): MasterHandoffPayload | undefined {
  if (!input.handoffId || typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey(input.handoffId));
    if (!raw) {
      return undefined;
    }
    const payload = parsePayload(raw);
    if (!payload) {
      return undefined;
    }
    if (sanitizeReturnTo(payload.returnTo) !== sanitizeReturnTo(input.expectedReturnTo)) {
      return undefined;
    }
    if (
      input.expectedMatchSessionId !== undefined &&
      payload.matchSessionId !== input.expectedMatchSessionId
    ) {
      return undefined;
    }
    if (isExpired(payload.createdAt, input.nowMs ?? Date.now())) {
      return undefined;
    }
    return payload;
  } catch {
    return undefined;
  }
}

export function findLatestMasterHandoff(input: {
  expectedMatchSessionId: string;
  expectedReturnTo: string;
  nowMs?: number;
}): { handoffId: string; payload: MasterHandoffPayload } | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const candidates: Array<{ handoffId: string; payload: MasterHandoffPayload }> = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (!key?.startsWith(handoffStoragePrefix)) {
      continue;
    }
    const handoffId = key.slice(handoffStoragePrefix.length);
    const loadInput: Parameters<typeof loadMasterHandoff>[0] = {
      expectedMatchSessionId: input.expectedMatchSessionId,
      expectedReturnTo: input.expectedReturnTo,
      handoffId,
    };
    if (typeof input.nowMs === "number") {
      loadInput.nowMs = input.nowMs;
    }
    const payload = loadMasterHandoff(loadInput);
    if (payload) {
      candidates.push({ handoffId, payload });
    }
  }

  return candidates.toSorted(
    (left, right) => Date.parse(right.payload.createdAt) - Date.parse(left.payload.createdAt),
  )[0];
}

export function removeMasterHandoff(handoffId: string | null | undefined): void {
  if (!handoffId || typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(storageKey(handoffId));
  } catch {
    // no-op: best effort cleanup
  }
}

export function clearHandoffIdFromSearch(searchParams: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete("handoffId");
  return next;
}
