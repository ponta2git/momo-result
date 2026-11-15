import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Log, LogLevel, Miniflare } from "miniflare";

import { startEdge } from "./local.mts";

test("deployable Worker preserves the public HTTP boundary in workerd", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "momo-edge-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const token = randomBytes(32).toString("hex");
  const observed: { path: string; method: string; headers: IncomingHttpHeaders; body: Buffer }[] =
    [];
  let finishDownload: (() => void) | undefined;
  const stalledRequests = new Map<string, { started: () => void; closed: () => void }>();
  const upstream = createServer(async (request, response) => {
    if (request.url === "/api/early-upload-rejection") {
      request.on("error", () => {});
      response.writeHead(413);
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    observed.push({
      path: request.url!,
      method: request.method!,
      headers: request.headers,
      body: Buffer.concat(chunks),
    });
    const stalled = stalledRequests.get(request.url!);
    if (stalled) {
      response.once("close", stalled.closed);
      if (request.url === "/api/stream-cancel") response.write("first");
      stalled.started();
    } else if (request.url?.startsWith("/api/login")) {
      response.writeHead(302, {
        Location: "/login/complete?next=%2Fmatches",
        "Set-Cookie": ["session=fixture; HttpOnly; Path=/", "csrf=fixture; Path=/"],
      });
      response.end();
    } else if (request.url?.endsWith("/source-images.zip")) {
      response.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="images.zip"',
      });
      response.write("first");
      finishDownload = () => response.end("last");
    } else {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(Buffer.concat(chunks));
    }
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    finishDownload?.();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
  const artifactDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
  const apiOrigin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const edge = await startEdge({
    artifactDirectory,
    apiOrigin,
    originLockToken: token,
    runDirectory: directory,
    signal: AbortSignal.timeout(30_000),
  });
  t.after(edge.close);
  // Wrangler's local routing Worker predates enable_request_signal. Exercise
  // cancellation on workerd's direct HTTP socket with the identical bundle.
  // Only these transport requests inject the platform-owned client IP locally.
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
            MOMO_ORIGIN_LOCK_TOKEN: { type: "text", value: token },
            MOMO_ALLOW_LOCAL_ORIGIN: { type: "text", value: "true" },
          },
        },
        dev: { unsafeDirectSockets: [{ host: "127.0.0.1", port: 0 }] },
      },
    ],
  });
  t.after(() => direct.dispose());
  const directOrigin = (await direct.unsafeGetDirectURL()).origin;
  const request = (path: string, init?: RequestInit) =>
    fetch(`${edge.origin}${path}`, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });

  await t.test(
    "SPA and assets retain security, cache, missing-file, and method behavior",
    async () => {
      const home = await request("/");
      assert.equal(home.status, 200);
      assert.equal(home.headers.get("cache-control"), "no-cache");
      assert.equal(home.headers.get("x-content-type-options"), "nosniff");
      assert.equal(home.headers.get("x-frame-options"), "DENY");
      assert.equal(home.headers.get("referrer-policy"), "no-referrer");
      assert.match(home.headers.get("content-security-policy")!, /frame-ancestors 'none'/u);
      const html = await home.text();
      const deepLink = await request("/matches/example?tab=results");
      assert.equal(deepLink.status, 200);
      assert.equal(await deepLink.text(), html);
      const assetPath = html.match(/\/assets\/[^"\s<>]+/u)?.[0];
      assert.ok(assetPath);
      const asset = await request(assetPath);
      assert.equal(asset.status, 200);
      assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
      await asset.body?.cancel();
      const head = await request(assetPath, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");
      for (const path of ["/assets/missing.js", "/missing.png", "/openapi.yaml", "/.env"])
        assert.equal((await request(path)).status, 404, path);
      for (const path of ["/", "/assets/missing.js"])
        assert.equal((await request(path, { method: "POST" })).status, 405);
    },
  );

  await t.test(
    "API routes preserve bytes/query/auth and overwrite the trusted boundary",
    async () => {
      const body = Buffer.from([0, 255, 10, 13, 128]);
      const response = await request("/api/upload?name=a%2Fb&name=c", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/octet-stream",
          Cookie: "session=fixture",
          "X-CSRF-Token": "fixture",
          "X-Momo-Origin-Lock": "spoofed",
          "X-Momo-Client-IP": "203.0.113.7",
          "X-Momo-Runtime-Probe": "v1",
          Forwarded: "for=203.0.113.7",
          "X-Forwarded-For": "203.0.113.7",
          "X-Forwarded-Host": "spoofed.example",
          "X-Forwarded-Proto": "http",
          "X-Real-IP": "203.0.113.7",
          "True-Client-IP": "203.0.113.7",
        },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
      const received = observed.at(-1)!;
      assert.equal(received.path, "/api/upload?name=a%2Fb&name=c");
      assert.equal(received.method, "POST");
      assert.deepEqual(received.body, body);
      assert.equal(received.headers["content-length"], String(body.length));
      assert.equal(received.headers.cookie, "session=fixture");
      assert.equal(received.headers["x-csrf-token"], "fixture");
      assert.ok(received.headers["x-momo-origin-lock"] === token);
      assert.equal(received.headers["x-momo-client-ip"], "127.0.0.1");
      for (const name of [
        "forwarded",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-real-ip",
        "true-client-ip",
        "x-momo-runtime-probe",
      ])
        assert.equal(received.headers[name], undefined, name);
      for (const path of ["/api", "/healthz", "/healthz/details"]) {
        const health = await request(path);
        assert.equal(health.status, 200);
        assert.equal(health.headers.get("cache-control"), "no-store");
        assert.equal(observed.at(-1)!.path, path);
        await health.body?.cancel();
      }
      const count = observed.length;
      for (const path of [
        "/api/__momo_runtime/http2-probe",
        "/__momo_runtime/probe",
        "/api/%5f_momo_runtime/http2-probe",
        "/api/%2Eprivate",
      ])
        assert.equal((await request(path)).status, 404, path);
      assert.equal(observed.length, count);
    },
  );

  await t.test("login redirects preserve each cookie without following Location", async () => {
    const response = await request("/api/login");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/login/complete?next=%2Fmatches");
    assert.deepEqual(response.headers.getSetCookie(), [
      "session=fixture; HttpOnly; Path=/",
      "csrf=fixture; Path=/",
    ]);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  await t.test("download bytes arrive before upstream completion and remain private", async () => {
    const response = await request("/api/match-drafts/example/source-images.zip");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="images.zip"');
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), "first");
    finishDownload!();
    const last = await reader.read();
    assert.equal(new TextDecoder().decode(last.value), "last");
    assert.equal((await reader.read()).done, true);
  });

  await t.test(
    "client disconnect cancels both an upstream header wait and a streaming body",
    async () => {
      for (const path of ["/api/headers-cancel", "/api/stream-cancel"]) {
        const started = completion();
        const closed = completion();
        stalledRequests.set(path, { started: started.resolve, closed: closed.resolve });
        const endpoint = new URL(directOrigin);
        const client = connect(Number(endpoint.port), endpoint.hostname);
        const bodyStarted = completion();
        let body = "";
        client.on("data", (chunk) => {
          body += chunk.toString();
          if (body.includes("first")) bodyStarted.resolve();
        });
        try {
          await new Promise<void>((resolve, reject) => {
            client.once("connect", resolve);
            client.once("error", reject);
          });
          client.write(
            `GET ${path} HTTP/1.1\r\nHost: ${endpoint.host}\r\nCF-Connecting-IP: 127.0.0.1\r\n\r\n`,
          );
          await within(started.promise, 5_000);
          if (path === "/api/stream-cancel") await within(bodyStarted.promise, 5_000);
          // A reset is an actual disconnect. A TCP half-close still permits the
          // server to send a response and cannot prove cancellation before headers.
          client.resetAndDestroy();
          await within(closed.promise, 5_000);
        } finally {
          client.destroy();
        }
      }
    },
  );

  await t.test(
    "slow uploads finish before the header wait starts and early rejection does not wait for EOF",
    async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          const timer = setTimeout(() => {
            controller.enqueue(new Uint8Array([2]));
            controller.close();
          }, 31_000);
          t.after(() => clearTimeout(timer));
        },
      });
      const init = {
        method: "POST",
        body,
        duplex: "half",
        headers: { "CF-Connecting-IP": "127.0.0.1", "Content-Length": "2" },
        signal: AbortSignal.timeout(40_000),
      };
      const response = await fetch(`${directOrigin}/api/slow-upload`, init);
      assert.equal(response.status, 200);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2]));
      assert.equal(observed.at(-1)!.headers["content-length"], "2");

      let finishRejectedUpload = () => {};
      const rejectedBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          finishRejectedUpload = () => {
            try {
              controller.enqueue(new Uint8Array([2]));
              controller.close();
            } catch {
              // The client may already have canceled after the early response.
            }
          };
        },
      });
      try {
        const rejected = await fetch(`${directOrigin}/api/early-upload-rejection`, {
          ...init,
          body: rejectedBody,
          signal: AbortSignal.timeout(5_000),
        });
        assert.equal(rejected.status, 413);
        await rejected.body?.cancel();
      } finally {
        finishRejectedUpload();
      }
    },
  );

  await t.test(
    "an upstream without response headers times out and releases its connection",
    async () => {
      const closed = completion();
      stalledRequests.set("/api/header-timeout", { started: () => {}, closed: closed.resolve });
      const response = await fetch(`${directOrigin}/api/header-timeout`, {
        headers: { "CF-Connecting-IP": "127.0.0.1" },
        signal: AbortSignal.timeout(35_000),
      });
      assert.equal(response.status, 504);
      assert.equal(response.headers.get("cache-control"), "no-store");
      await within(closed.promise, 5_000);
    },
  );
});

function completion() {
  let done: () => void;
  const promise = new Promise<void>((resolve) => {
    done = resolve;
  });
  return { promise, resolve: () => done() };
}

async function within(promise: Promise<void>, timeout: number) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      promise,
      new Promise<void>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The upstream connection was not released.")),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
