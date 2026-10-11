import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { settle } from "./settle.mts";

test("failed startup waits for late resource ownership before cleanup", async () => {
  let resolveLate: ((resource: string) => void) | undefined;
  const late = new Promise<string>((resolve) => {
    resolveLate = resolve;
  });
  const resources: string[] = [];
  const failure = new Error("startup failed");
  let cleaned = false;
  const result = settle([
    Promise.reject(failure),
    late.then((resource) => {
      resources.push(resource);
      return resource;
    }),
  ]).finally(() => {
    assert.deepEqual(resources, ["late container"]);
    cleaned = true;
  });
  const rejected = assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failure]);
    return true;
  });
  await setImmediate();
  assert.equal(cleaned, false);
  assert.ok(resolveLate);
  resolveLate("late container");
  await rejected;
  assert.equal(cleaned, true);
});

test("successful startup returns each task result in input order", async () => {
  assert.deepEqual(await settle([Promise.resolve("database"), Promise.resolve(42)]), [
    "database",
    42,
  ]);
});
