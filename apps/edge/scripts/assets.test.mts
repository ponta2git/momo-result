import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/index.ts";
import type { AssetBinding } from "../src/assets.ts";

function get(path: string, fetch: AssetBinding["fetch"]) {
  return worker.fetch(new Request(new URL(path, "https://example.test")), {
    ASSETS: { fetch },
    API_ORIGIN: "",
    MOMO_ORIGIN_LOCK_TOKEN: "",
  });
}

test("directory routes need one asset lookup and an extensionless file wins over the shell", async () => {
  for (const [path, file] of [
    ["/", "/index.html"],
    ["/matches/example/", "/index.html"],
    ["/download", "/download"],
  ] as const) {
    const lookups: string[] = [];
    const response = await get(path, async (request) => {
      const resource = new URL(request.url).pathname;
      lookups.push(resource);
      return new Response(resource);
    });
    assert.equal(await response.text(), file);
    assert.deepEqual(lookups, [file]);
  }
});

test("unavailable assets return a retryable failure, including during shell fallback", async () => {
  for (const path of ["/assets/app.js", "/matches/example"]) {
    const response = await get(path, async (request) => {
      if (new URL(request.url).pathname === "/matches/example")
        return new Response(null, { status: 404 });
      throw new Error("asset binding is unavailable");
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
  }
});
