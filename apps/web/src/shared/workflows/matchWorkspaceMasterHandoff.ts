import {
  browserSessionStorage,
  createMatchWorkspaceMasterHandoffPayload,
  handoffStoragePrefix,
  isExpired,
  parsePayload,
  storageKey,
} from "@/shared/workflows/matchWorkspaceMasterHandoffPayload";
import type {
  MasterHandoffPayload,
  MasterHandoffReadOptions,
  MasterHandoffSaveOptions,
  MatchWorkspaceHandoffValues,
  MasterHandoffStorage,
} from "@/shared/workflows/matchWorkspaceMasterHandoffPayload";

export type {
  MasterHandoffPayload,
  MatchWorkspaceHandoffValues,
  MatchWorkspaceMasterHandoffValues,
} from "@/shared/workflows/matchWorkspaceMasterHandoffPayload";
export {
  createMatchWorkspaceHandoffPayload,
  createMatchWorkspaceMasterHandoffPayload,
} from "@/shared/workflows/matchWorkspaceMasterHandoffPayload";

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

function defaultHandoffId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function saveMasterHandoff(
  payload: MasterHandoffPayload,
  options: MasterHandoffSaveOptions = {},
): string | undefined {
  const storage = options.storage ?? browserSessionStorage();
  if (!storage) {
    return undefined;
  }
  try {
    const handoffId = (options.createId ?? defaultHandoffId)();
    storage.setItem(storageKey(handoffId), JSON.stringify(payload));
    return handoffId;
  } catch {
    return undefined;
  }
}

export type MatchWorkspaceMasterHandoffRouteResult =
  | { handoffId: string; route: string; status: "available" }
  | { reason: "storage_unavailable"; status: "unavailable" };

export function prepareMatchWorkspaceMasterHandoffRoute(input: {
  createdAt?: string;
  createId?: () => string;
  matchSessionId: string;
  returnTo: string;
  storage?: MasterHandoffStorage;
  values: MatchWorkspaceHandoffValues;
}): MatchWorkspaceMasterHandoffRouteResult {
  const payload = createMatchWorkspaceMasterHandoffPayload(input);
  const saveOptions: MasterHandoffSaveOptions = {};
  if (input.createId) {
    saveOptions.createId = input.createId;
  }
  if (input.storage) {
    saveOptions.storage = input.storage;
  }
  const handoffId = saveMasterHandoff(payload, saveOptions);
  if (!handoffId) {
    return { reason: "storage_unavailable", status: "unavailable" };
  }
  return {
    handoffId,
    route: buildMasterRoute(input.returnTo, handoffId),
    status: "available",
  };
}

export function inspectMasterHandoff(
  input: {
    expectedMatchSessionId?: string | undefined;
    expectedReturnTo: string;
    handoffId: string | null | undefined;
    nowMs?: number;
  } & MasterHandoffReadOptions,
): HandoffInspectResult {
  const storage = input.storage ?? browserSessionStorage();
  if (!input.handoffId || !storage) {
    return { status: "missing" };
  }

  try {
    const raw = storage.getItem(storageKey(input.handoffId));
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

export function loadMasterHandoff(
  input: {
    expectedMatchSessionId?: string | undefined;
    expectedReturnTo: string;
    handoffId: string | null | undefined;
    nowMs?: number;
  } & MasterHandoffReadOptions,
): MasterHandoffPayload | undefined {
  const storage = input.storage ?? browserSessionStorage();
  if (!input.handoffId || !storage) {
    return undefined;
  }

  try {
    const raw = storage.getItem(storageKey(input.handoffId));
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

export function findLatestMasterHandoff(
  input: {
    expectedMatchSessionId: string;
    expectedReturnTo: string;
    nowMs?: number;
  } & MasterHandoffReadOptions,
): { handoffId: string; payload: MasterHandoffPayload } | undefined {
  const storage = input.storage ?? browserSessionStorage();
  if (!storage) {
    return undefined;
  }

  const candidates: Array<{ handoffId: string; payload: MasterHandoffPayload }> = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(handoffStoragePrefix)) {
        continue;
      }
      const handoffId = key.slice(handoffStoragePrefix.length);
      const loadInput: Parameters<typeof loadMasterHandoff>[0] = {
        expectedMatchSessionId: input.expectedMatchSessionId,
        expectedReturnTo: input.expectedReturnTo,
        handoffId,
        storage,
      };
      if (typeof input.nowMs === "number") {
        loadInput.nowMs = input.nowMs;
      }
      const payload = loadMasterHandoff(loadInput);
      if (payload) {
        candidates.push({ handoffId, payload });
      }
    }
  } catch {
    return undefined;
  }

  return candidates.toSorted(
    (left, right) => Date.parse(right.payload.createdAt) - Date.parse(left.payload.createdAt),
  )[0];
}

export function removeMasterHandoff(
  handoffId: string | null | undefined,
  options: MasterHandoffReadOptions = {},
): void {
  const storage = options.storage ?? browserSessionStorage();
  if (!handoffId || !storage) {
    return;
  }
  try {
    storage.removeItem(storageKey(handoffId));
  } catch {
    // no-op: best effort cleanup
  }
}

export function clearHandoffIdFromSearch(searchParams: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete("handoffId");
  return next;
}
