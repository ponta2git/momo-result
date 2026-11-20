import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempDisposable, readdir, readFile } from "node:fs/promises";
import { get } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer, text } from "node:stream/consumers";
import { test } from "node:test";

import { artifactDirectory, startOrigin } from "./edge-fixture.mts";
import { startEdge } from "./local.mts";

// Fetch sets Sec-Fetch-Mode itself. Use HTTP to send the header a browser sends on navigation.
function navigate(url: string) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    get(
      url,
      { headers: { "Sec-Fetch-Mode": "navigate" }, signal: AbortSignal.timeout(5_000) },
      resolve,
    ).once("error", reject);
  });
}

test("deployable Worker and static assets over HTTP", async (t) => {
  const upstream = await startOrigin(t);
  const originLockToken = randomBytes(32).toString("hex");
  await using directory = await mkdtempDisposable(join(tmpdir(), "momo-edge-test-"));
  const options = {
    artifactDirectory,
    apiOrigin: upstream.url,
    originLockToken,
    runDirectory: directory.path,
    signal: AbortSignal.timeout(30_000),
  };
  await t.test("an interrupted start releases its local configuration before retry", async () => {
    const interrupted = new AbortController();
    await assert.rejects(
      startEdge({
        ...options,
        signal: interrupted.signal,
        onProcess: () => interrupted.abort(),
      }),
      { name: "AbortError" },
    );
    assert.deepEqual(await readdir(directory.path), []);
  });
  const edge = await startEdge(options);
  try {
    const request = (path: string, init?: RequestInit) =>
      fetch(`${edge.origin}${path}`, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });

    await t.test(
      "pages and browser deep links serve the revalidatable application shell",
      async () => {
        const html = await readFile(join(artifactDirectory, "assets/index.html"), "utf8");
        const home = await request("/");
        assert.equal(home.status, 200);
        assert.equal(await home.text(), html);
        assert.equal(home.headers.get("cache-control"), "no-cache");
        assert.equal(home.headers.get("x-content-type-options"), "nosniff");
        assert.equal(home.headers.get("x-frame-options"), "DENY");
        assert.equal(home.headers.get("referrer-policy"), "no-referrer");
        assert.match(home.headers.get("content-security-policy")!, /frame-ancestors 'none'/u);
        const etag = home.headers.get("etag");
        assert.ok(etag);
        const path = "/matches/example?tab=results";
        const navigation = await navigate(edge.origin + path);
        assert.equal(navigation.statusCode, 200);
        assert.equal(navigation.headers["cache-control"], "no-cache");
        assert.equal(await text(navigation), html);
        const revalidated = await request(path, { headers: { "If-None-Match": etag } });
        assert.equal(revalidated.status, 304);
        assert.equal(revalidated.headers.get("cache-control"), "no-cache");
        assert.equal(await revalidated.text(), "");
        const icon = await request("/favicon.svg");
        assert.equal(icon.status, 200);
        assert.equal(icon.headers.get("cache-control"), "no-cache");
        assert.match(icon.headers.get("content-type")!, /image\/svg\+xml/u);
        await icon.body?.cancel();
      },
    );

    await t.test(
      "versioned JavaScript retains its bytes, media type, cache policy and validators",
      async () => {
        const html = await readFile(join(artifactDirectory, "assets/index.html"), "utf8");
        const assetPath = html.match(/<script\b[^>]*\bsrc="(\/assets\/[^"]+\.js)"/u)?.[1];
        assert.ok(assetPath, "Missing JavaScript entry in the application shell");
        const asset = await request(assetPath);
        const immutable = "public, max-age=31536000, immutable";
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get("content-type")!, /javascript/u);
        assert.equal(asset.headers.get("cache-control"), immutable);
        assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
        const expected = await readFile(join(artifactDirectory, "assets", assetPath));
        assert.ok(
          expected.equals(Buffer.from(await asset.arrayBuffer())),
          "JavaScript bundle differs from the deployed file",
        );
        const etag = asset.headers.get("etag");
        assert.ok(etag);
        const head = await request(assetPath, { method: "HEAD" });
        assert.equal(head.status, 200);
        assert.equal(head.headers.get("etag"), etag);
        assert.equal(await head.text(), "");
        const revalidated = await request(assetPath, { headers: { "If-None-Match": etag } });
        assert.equal(revalidated.status, 304);
        assert.equal(revalidated.headers.get("cache-control"), immutable);
        assert.equal(await revalidated.text(), "");
        const post = await request(assetPath, { method: "POST" });
        assert.equal(post.status, 405);
        assert.equal(post.headers.get("allow"), "GET, HEAD");
        assert.equal(post.headers.get("cache-control"), "no-store");
      },
    );

    await t.test("missing resources and rejected methods stay uncached on navigation", async () => {
      for (const path of [
        "/assets/missing.js",
        "/assets/missing",
        "/missing.png",
        "/openapi.yaml",
        "/.env",
      ]) {
        const missing = await navigate(edge.origin + path);
        assert.equal(missing.statusCode, 404, path);
        assert.equal(missing.headers["cache-control"], "no-store", path);
        missing.resume();
      }
      for (const path of ["/", "/assets/missing.js"]) {
        const rejected = await request(path, { method: "POST" });
        assert.equal(rejected.status, 405, path);
        assert.equal(rejected.headers.get("cache-control"), "no-store", path);
      }
    });

    await t.test(
      "API writes preserve the operation key, upload bytes, query and authentication",
      async () => {
        const path = "/api/upload?name=a%2Fb&name=c";
        const received = new Promise<IncomingMessage>((resolve) => {
          upstream.on(path, async (request, response) => {
            response.end(await buffer(request));
            resolve(request);
          });
        });
        const body = Buffer.from([0, 255, 10, 13, 128]);
        const operationKey = randomUUID();
        const response = await request(path, {
          method: "POST",
          body,
          headers: {
            "Content-Type": "application/octet-stream",
            "Idempotency-Key": operationKey,
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
        const forwarded = await received;
        assert.equal(forwarded.method, "POST");
        const headers = forwarded.headers;
        assert.equal(headers["content-length"], String(body.length));
        assert.equal(headers["idempotency-key"], operationKey);
        assert.equal(headers.cookie, "session=fixture");
        assert.equal(headers["x-csrf-token"], "fixture");
        assert.ok(headers["x-momo-origin-lock"] === originLockToken);
        assert.equal(headers["x-momo-client-ip"], "127.0.0.1");
        for (const name of [
          "forwarded",
          "x-forwarded-for",
          "x-forwarded-host",
          "x-forwarded-proto",
          "x-real-ip",
          "true-client-ip",
          "x-momo-runtime-probe",
        ])
          assert.equal(headers[name], undefined, name);
      },
    );

    await t.test("API and health navigations reach only public endpoints", async () => {
      for (const path of ["/api", "/healthz", "/healthz/details"]) {
        upstream.on(path, (_req, res) => res.end(path));
        const response = await navigate(edge.origin + path);
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers["cache-control"], "no-store");
        assert.equal(await text(response), path);
      }
      for (const path of [
        "/api/__momo_runtime/http2-probe",
        "/__momo_runtime/probe",
        "/api/%5f_momo_runtime/http2-probe",
        "/api/%2Eprivate",
      ]) {
        assert.equal((await request(path)).status, 404, path);
      }
    });

    await t.test("login redirects preserve both cookies and the original Location", async () => {
      upstream.on("/api/login", (_req, res) =>
        res
          .writeHead(302, {
            Location: "/login/complete?next=%2Fmatches",
            "Set-Cookie": ["session=fixture; HttpOnly; Path=/", "csrf=fixture; Path=/"],
          })
          .end(),
      );
      const response = await request("/api/login");
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/login/complete?next=%2Fmatches");
      assert.deepEqual(response.headers.getSetCookie(), [
        "session=fixture; HttpOnly; Path=/",
        "csrf=fixture; Path=/",
      ]);
      assert.equal(response.headers.get("cache-control"), "no-store");
    });

    await t.test("a private download begins before the origin finishes sending", async () => {
      const path = "/api/match-drafts/example/source-images.zip";
      const download = new Promise<ServerResponse>((resolve) =>
        upstream.on(path, (_req, res) => {
          res.writeHead(200, {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="images.zip"',
          });
          res.write("first");
          resolve(res);
        }),
      );
      const response = await request(path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(
        response.headers.get("content-disposition"),
        'attachment; filename="images.zip"',
      );
      const reader = response.body!.getReader();
      const first = await reader.read();
      assert.equal(new TextDecoder().decode(first.value), "first");
      (await download).end("last");
      assert.equal(new TextDecoder().decode((await reader.read()).value), "last");
      assert.equal((await reader.read()).done, true);
    });

    await t.test("an origin connection failure returns an uncached gateway error", async () => {
      upstream.on("/api/unavailable", (_, res) => res.destroy());
      const response = await request("/api/unavailable");
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(await response.text(), "");
    });
  } finally {
    await edge.close();
  }
  assert.deepEqual(await readdir(directory.path), []);
});
