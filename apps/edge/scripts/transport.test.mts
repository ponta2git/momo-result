import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { Log, LogLevel, Miniflare } from "miniflare";

import { artifactDirectory, startOrigin } from "./edge-fixture.mts";

// Wrangler's local routing Worker predates enable_request_signal. Its direct HTTP socket
// exercises the deployable bundle with client disconnects and streaming request bodies.
async function startTransport(t: TestContext, apiOrigin: string) {
  const config = JSON.parse(await readFile(join(artifactDirectory, "wrangler.json"), "utf8"));
  const direct = new Miniflare({
    host: "127.0.0.1",
    port: 0,
    cf: false,
    log: new Log(LogLevel.NONE),
    logRequests: false,
    enableDevRegistry: false,
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: "edge-transport",
          compatibilityDate: config.compatibility_date,
          compatibilityFlags: config.compatibility_flags,
          manifest: {
            mainModule: "index.js",
            modulesRoot: "/",
            modules: {
              "index.js": {
                type: "esm",
                contents: await readFile(join(artifactDirectory, config.main), "utf8"),
              },
            },
          },
          env: {
            API_ORIGIN: { type: "text", value: apiOrigin },
            MOMO_ORIGIN_LOCK_TOKEN: { type: "text", value: randomBytes(32).toString("hex") },
            MOMO_ALLOW_LOCAL_ORIGIN: { type: "text", value: "true" },
          },
        },
        dev: { unsafeDirectSockets: [{ host: "127.0.0.1", port: 0 }] },
      },
    ],
  });
  t.after(() => direct.dispose());
  return direct.unsafeGetDirectURL();
}

test("API transport in workerd", { concurrency: true }, async (t) => {
  const upstream = await startOrigin(t);
  const endpoint = await startTransport(t, upstream.url);
  // The direct socket has no platform proxy to supply the client address.
  const clientHeaders = { "CF-Connecting-IP": "127.0.0.1" };

  await t.test("missing client metadata fails closed before contacting the origin", async () => {
    const response = await fetch(new URL("/api/unavailable", endpoint), {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  await t.test("an upload without a declared length reaches the origin intact", async () => {
    const path = "/api/stream-upload";
    upstream.on(path, async (req, res) => res.end(await buffer(req)));
    const bytes = new Uint8Array([0, 255, 128]);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 1));
        controller.enqueue(bytes.subarray(1));
        controller.close();
      },
    });
    const init = {
      method: "POST",
      duplex: "half",
      body,
      headers: clientHeaders,
      signal: AbortSignal.timeout(5_000),
    };
    const response = await fetch(new URL(path, endpoint), init);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  });

  await t.test("an early rejection arrives while the upload is still open", async () => {
    const path = "/api/early-upload-rejection";
    upstream.on(path, (req, res) => {
      req.on("error", () => {});
      res.writeHead(413).end();
    });
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new Uint8Array([1]));
      },
    });
    try {
      const init = {
        method: "POST",
        duplex: "half",
        body,
        headers: { ...clientHeaders, "Content-Length": "2" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
      };
      const response = await fetch(new URL(path, endpoint), init);
      assert.equal(response.status, 413);
      await response.body?.cancel();
    } finally {
      controller.abort();
    }
  });

  await t.test(
    "client disconnect releases an upstream header wait and streaming response",
    { timeout: 15_000 },
    async (t) => {
      for (const path of ["/api/headers-cancel", "/api/stream-cancel"]) {
        const started = new Promise<ServerResponse>((resolve) =>
          upstream.on(path, (_req, res) => {
            if (path === "/api/stream-cancel") res.write("first");
            resolve(res);
          }),
        );
        const client = connect(Number(endpoint.port), endpoint.hostname);
        let received = "";
        const firstChunk = new Promise<void>((resolve) =>
          client.on("data", (chunk) => {
            received += chunk.toString();
            if (received.includes("first")) resolve();
          }),
        );
        try {
          await once(client, "connect", { signal: t.signal });
          client.write(
            `GET ${path} HTTP/1.1\r\nHost: ${endpoint.host}\r\nCF-Connecting-IP: 127.0.0.1\r\n\r\n`,
          );
          const closed = once(await started, "close", { signal: t.signal });
          if (path === "/api/stream-cancel") await firstChunk;
          // A half-close still permits a response and cannot prove cancellation before headers.
          client.resetAndDestroy();
          await closed;
        } finally {
          client.destroy();
        }
      }
    },
  );

  // Both requests cross the real response-header deadline. Run them concurrently.
  const slowUpload = t.test("a slow upload receives a full header wait after EOF", async (t) => {
    const path = "/api/slow-upload";
    let declaredLength: string | undefined;
    const firstByteReceived = new Promise<void>((resolve) =>
      upstream.on(path, async (req, res) => {
        declaredLength = req.headers["content-length"];
        req.once("data", resolve);
        res.end(await buffer(req));
      }),
    );
    const body = new ReadableStream<Uint8Array>({
      async start(stream) {
        stream.enqueue(new Uint8Array([1]));
        await firstByteReceived;
        await delay(31_000, undefined, { signal: t.signal });
        stream.enqueue(new Uint8Array([2]));
        stream.close();
      },
    });
    const init = {
      method: "POST",
      duplex: "half",
      body,
      headers: { ...clientHeaders, "Content-Length": "2" },
      signal: AbortSignal.timeout(40_000),
    };
    const response = await fetch(new URL(path, endpoint), init);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2]));
    assert.equal(declaredLength, "2");
  });
  const headerTimeout = t.test(
    "an origin response-header timeout releases the connection",
    { timeout: 40_000 },
    async () => {
      const path = "/api/header-timeout";
      const closed = new Promise<void>((resolve) =>
        upstream.on(path, (_req, res) => res.once("close", resolve)),
      );
      const response = await fetch(new URL(path, endpoint), {
        headers: clientHeaders,
        signal: AbortSignal.timeout(35_000),
      });
      assert.equal(response.status, 504);
      assert.equal(response.headers.get("cache-control"), "no-store");
      await closed;
    },
  );
  await Promise.all([slowUpload, headerTimeout]);
});
