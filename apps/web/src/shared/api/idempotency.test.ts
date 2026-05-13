// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createIdempotencyKeyStore, idempotencyFingerprint } from "@/shared/api/idempotency";

describe("idempotency key store", () => {
  it("reuses the same key for the same operation and JSON payload", () => {
    const store = createIdempotencyKeyStore();
    const first = store.keyFor("matchWorkspace.confirmMatch", { b: 2, a: 1 });
    const second = store.keyFor("matchWorkspace.confirmMatch", { a: 1, b: 2 });

    expect(second).toBe(first);
  });

  it("issues a new key when the operation or payload changes", () => {
    const store = createIdempotencyKeyStore();
    const first = store.keyFor("matchWorkspace.confirmMatch", { a: 1 });

    expect(store.keyFor("matchWorkspace.confirmMatch", { a: 2 })).not.toBe(first);
    expect(store.keyFor("matchWorkspace.updateMatch", { a: 1 })).not.toBe(first);
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
});
