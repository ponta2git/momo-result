// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  createIdempotencyKeyStore,
  idempotencyFingerprint,
  runIdempotentMutation,
} from "@/shared/api/idempotency";

describe("idempotency key store", () => {
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
      idempotencyFingerprint("ocrCapture.createOcrJob", {
        hints: { aliases: ["ぽんた"], omitted: undefined },
        imageId: "image-1",
      }),
    ).toBe(
      idempotencyFingerprint("ocrCapture.createOcrJob", {
        imageId: "image-1",
        hints: { aliases: ["ぽんた"] },
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
});
