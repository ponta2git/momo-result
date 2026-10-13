import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanupResources } from "./system-environment.mts";

test("partial startup cleanup reverses ownership and attempts dependencies after failure", async () => {
  const closed: string[] = [];
  await assert.rejects(
    cleanupResources([
      {
        label: "database",
        close: async () => {
          closed.push("database");
        },
      },
      {
        label: "receiver",
        close: async () => {
          closed.push("receiver");
          throw new Error("secret connection value");
        },
      },
      {
        label: "worker",
        close: async () => {
          closed.push("worker");
        },
      },
    ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "System E2E cleanup failed: receiver.");
      assert.doesNotMatch(String(error.stack), /secret connection value/u);
      return true;
    },
  );
  assert.deepEqual(closed, ["worker", "receiver", "database"]);
});
