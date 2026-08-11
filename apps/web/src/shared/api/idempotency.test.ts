// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createIdempotencyKey,
  createIdempotencyKeyStore,
  idempotencyFingerprint,
  runIdempotentMutation,
} from "@/shared/api/idempotency";

describe("idempotency key store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reuses the same key for the same operation and JSON payload", () => {
    const store = createIdempotencyKeyStore();
    const first = store.begin("matchWorkspace.confirmMatch", { b: 2, a: 1 }).key;
    const second = store.begin("matchWorkspace.confirmMatch", { a: 1, b: 2 }).key;

    expect(second).toBe(first);
  });

  it("issues a new key when the operation or payload changes", () => {
    const store = createIdempotencyKeyStore();
    const first = store.begin("matchWorkspace.confirmMatch", { a: 1 }).key;

    expect(store.begin("matchWorkspace.confirmMatch", { a: 2 }).key).not.toBe(first);
    expect(store.begin("matchWorkspace.updateMatch", { a: 1 }).key).not.toBe(first);
  });

  it("builds stable fingerprints for nested payloads", () => {
    expect(
      idempotencyFingerprint("ocrCapture.createUploadJob", {
        hints: { aliases: ["ぽんた"], omitted: undefined },
        imageId: "image-1",
      }),
    ).toBe(
      idempotencyFingerprint("ocrCapture.createUploadJob", {
        imageId: "image-1",
        hints: { aliases: ["ぽんた"] },
      }),
    );
  });

  it("normalizes undefined array entries without collapsing their positions", () => {
    expect(
      idempotencyFingerprint("ocrCapture.createUploadJob", {
        slots: [undefined, { kind: "revenue", omitted: undefined }],
      }),
    ).toBe(
      idempotencyFingerprint("ocrCapture.createUploadJob", {
        slots: [null, { kind: "revenue" }],
      }),
    );
  });

  it("closes an operation attempt after success", () => {
    const store = createIdempotencyKeyStore();
    const payload = { heldAt: "2026-01-01T00:00:00.000Z" };
    const first = store.begin("heldEvents.createHeldEvent", payload);

    expect(store.begin("heldEvents.createHeldEvent", payload).key).toBe(first.key);

    first.complete();

    expect(store.begin("heldEvents.createHeldEvent", payload).key).not.toBe(first.key);
  });

  it("runs a mutation with one operation attempt and completes it after success", async () => {
    const store = createIdempotencyKeyStore();
    const payload = { heldAt: "2026-01-01T00:00:00.000Z" };
    const first = await runIdempotentMutation(
      store,
      "heldEvents.createHeldEvent",
      payload,
      async (options) => options.idempotencyKey,
    );
    const second = await runIdempotentMutation(
      store,
      "heldEvents.createHeldEvent",
      payload,
      async (options) => options.idempotencyKey,
    );

    expect(second).not.toBe(first);
  });

  it("keeps the operation key active when a mutation fails before completion", async () => {
    const store = createIdempotencyKeyStore();
    const payload = { matchDraftId: "draft-1", slotKind: "total_assets" };
    const observedKeys: string[] = [];

    await expect(
      runIdempotentMutation(
        store,
        "ocrCapture.createUploadJob",
        payload,
        async ({ idempotencyKey }) => {
          observedKeys.push(idempotencyKey);
          throw new Error("job response was lost");
        },
      ),
    ).rejects.toThrow("job response was lost");

    const retriedKey = await runIdempotentMutation(
      store,
      "ocrCapture.createUploadJob",
      payload,
      async ({ idempotencyKey }) => idempotencyKey,
    );

    expect(retriedKey).toBe(observedKeys[0]);
  });

  it("resets an exact attempt, an operation, or the complete store", () => {
    const store = createIdempotencyKeyStore();
    const firstPayload = { matchDraftId: "draft-1" };
    const secondPayload = { matchDraftId: "draft-2" };
    const firstAttempt = store.begin("ocrCapture.createUploadJob", firstPayload);
    const first = firstAttempt.key;
    const second = store.begin("ocrCapture.createUploadJob", secondPayload).key;
    const unrelated = store.begin("matchWorkspace.confirmMatch", firstPayload).key;

    firstAttempt.reset();
    expect(store.begin("ocrCapture.createUploadJob", firstPayload).key).not.toBe(first);
    expect(store.begin("ocrCapture.createUploadJob", secondPayload).key).toBe(second);

    store.reset("ocrCapture.createUploadJob");
    expect(store.begin("ocrCapture.createUploadJob", secondPayload).key).not.toBe(second);
    expect(store.begin("matchWorkspace.confirmMatch", firstPayload).key).toBe(unrelated);

    store.reset();
    expect(store.begin("matchWorkspace.confirmMatch", firstPayload).key).not.toBe(unrelated);
  });

  it("creates RFC 4122 version 4 keys when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      },
    });

    expect(createIdempotencyKey()).toBe("abababab-abab-4bab-abab-abababababab");
  });

  it("retains a last-resort UUID path when Web Crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(createIdempotencyKey()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
