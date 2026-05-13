// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createIdempotencyKeyStore, idempotencyFingerprint } from "@/shared/api/idempotency";

describe("idempotency key store", () => {
  it("reuses the same key for the same operation and JSON payload", () => {
    const store = createIdempotencyKeyStore();
    const first = store.keyFor("matches.confirm", { b: 2, a: 1 });
    const second = store.keyFor("matches.confirm", { a: 1, b: 2 });

    expect(second).toBe(first);
  });

  it("issues a new key when the operation or payload changes", () => {
    const store = createIdempotencyKeyStore();
    const first = store.keyFor("matches.confirm", { a: 1 });

    expect(store.keyFor("matches.confirm", { a: 2 })).not.toBe(first);
    expect(store.keyFor("matches.update", { a: 1 })).not.toBe(first);
  });

  it("builds stable fingerprints for nested payloads", () => {
    expect(
      idempotencyFingerprint("ocr.job", {
        hints: { aliases: ["ぽんた"], omitted: undefined },
        imageId: "image-1",
      }),
    ).toBe(
      idempotencyFingerprint("ocr.job", {
        imageId: "image-1",
        hints: { aliases: ["ぽんた"] },
      }),
    );
  });
});
