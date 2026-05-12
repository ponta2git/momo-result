const handoffStoragePrefix = "momoresult.masterHandoff.";
const handoffSchemaVersion = 1;
const handoffTtlMs = 2 * 60 * 60 * 1000;

export type DraftReviewHandoffValues = {
  draftIds: {
    incidentLog?: string | undefined;
    revenue?: string | undefined;
    totalAssets?: string | undefined;
  };
  gameTitleId: string;
  heldEventId: string;
  mapMasterId: string;
  matchNoInEvent: number;
  ownerMemberId: string;
  playedAt: string;
  players: Array<{
    incidents: {
      cardShop: number;
      cardStation: number;
      destination: number;
      minusStation: number;
      plusStation: number;
      suriNoGinji: number;
    };
    memberId: string;
    playOrder: number;
    rank: number;
    revenueManYen: number;
    totalAssetsManYen: number;
  }>;
  seasonMasterId: string;
};

export type MasterHandoffPayload = {
  createdAt: string;
  matchSessionId: string;
  returnTo: string;
  schemaVersion: number;
  source: "draftReview";
  values: DraftReviewHandoffValues;
};

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
    const parsed = JSON.parse(raw) as Partial<MasterHandoffPayload>;
    if (
      parsed?.schemaVersion !== handoffSchemaVersion ||
      parsed?.source !== "draftReview" ||
      typeof parsed?.createdAt !== "string" ||
      typeof parsed?.returnTo !== "string" ||
      typeof parsed?.matchSessionId !== "string" ||
      !parsed?.values
    ) {
      return undefined;
    }
    return parsed as MasterHandoffPayload;
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

export function createDraftReviewHandoffPayload(input: {
  matchSessionId: string;
  returnTo: string;
  values: DraftReviewHandoffValues;
}): MasterHandoffPayload {
  return {
    createdAt: new Date().toISOString(),
    matchSessionId: input.matchSessionId,
    returnTo: input.returnTo,
    schemaVersion: handoffSchemaVersion,
    source: "draftReview",
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
        incidents: {
          cardShop: player.incidents.cardShop,
          cardStation: player.incidents.cardStation,
          destination: player.incidents.destination,
          minusStation: player.incidents.minusStation,
          plusStation: player.incidents.plusStation,
          suriNoGinji: player.incidents.suriNoGinji,
        },
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
