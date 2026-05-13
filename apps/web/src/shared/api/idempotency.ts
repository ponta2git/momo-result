export type IdempotencyKeyStore = {
  begin: (operation: IdempotencyOperation, payload: unknown) => IdempotencyOperationAttempt;
  complete: (operation: IdempotencyOperation, payload: unknown) => void;
  keyFor: (operation: IdempotencyOperation, payload: unknown) => string;
  reset: (operation?: IdempotencyOperation, payload?: unknown) => void;
};

export const idempotencyOperations = [
  "adminAccounts.createLoginAccount",
  "heldEvents.createHeldEvent",
  "masters.createGameTitle",
  "masters.createMapMaster",
  "masters.createMemberAlias",
  "masters.createSeasonMaster",
  "matchDetail.deleteMatch",
  "matchWorkspace.cancelMatchDraft",
  "matchWorkspace.confirmMatch",
  "matchWorkspace.createHeldEvent",
  "matchWorkspace.updateMatch",
  "ocrCapture.cancelMatchDraft",
  "ocrCapture.createMatchDraft",
  "ocrCapture.createOcrJob",
] as const;

export type IdempotencyOperation = (typeof idempotencyOperations)[number];

export type IdempotencyOperationAttempt = {
  complete: () => void;
  key: string;
  operation: IdempotencyOperation;
  payload: unknown;
  reset: () => void;
};

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

function normalizeForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : normalizeForJson(item)));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, normalizeForJson(entryValue)]),
  );
}

export function idempotencyFingerprint(operation: IdempotencyOperation, payload: unknown): string {
  return `${operation}:${stableJson(payload)}`;
}

export function createIdempotencyKeyStore(): IdempotencyKeyStore {
  const keys = new Map<string, string>();
  const reset = (operation?: IdempotencyOperation, payload?: unknown) => {
    if (operation === undefined) {
      keys.clear();
      return;
    }
    if (payload === undefined) {
      const prefix = `${operation}:`;
      for (const fingerprint of keys.keys()) {
        if (fingerprint.startsWith(prefix)) {
          keys.delete(fingerprint);
        }
      }
      return;
    }
    keys.delete(idempotencyFingerprint(operation, payload));
  };
  const keyFor = (operation: IdempotencyOperation, payload: unknown): string => {
    const fingerprint = idempotencyFingerprint(operation, payload);
    const existing = keys.get(fingerprint);
    if (existing) {
      return existing;
    }
    const key = createIdempotencyKey();
    keys.set(fingerprint, key);
    return key;
  };

  return {
    begin(operation, payload) {
      const attempt = {
        complete: () => reset(operation, payload),
        key: keyFor(operation, payload),
        operation,
        payload,
        reset: () => reset(operation, payload),
      };
      return attempt;
    },
    complete: reset,
    keyFor,
    reset,
  };
}
