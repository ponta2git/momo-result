import assert from "node:assert/strict";
import { test } from "node:test";

import { summitNode } from "./summit-node.mts";

test("consumer runtime cannot silently resolve through the Web runner PATH", async () => {
  await assert.rejects(summitNode("node"), /absolute Node.js executable/u);
});

test("consumer runtime enforces the pinned major before allocating E2E resources", async () => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major === 26 && minor !== undefined && minor >= 13) {
    assert.equal(await summitNode(process.execPath), process.execPath);
  } else {
    await assert.rejects(summitNode(process.execPath), /requires Node.js 26/u);
  }
});
