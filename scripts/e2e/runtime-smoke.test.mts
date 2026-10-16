import assert from "node:assert/strict";
import { createServer as createHTTPServer } from "node:http";
import { createServer as createHTTP2Server, type ServerHttp2Stream } from "node:http2";
import { createServer as createTCPServer, connect, type AddressInfo, type Socket } from "node:net";
import { test, type TestContext } from "node:test";
import { checkHTTP2, runSmoke } from "./runtime-smoke.mts";

async function fixture(t: TestContext, broken = "") {
  const host = "smoke.example";
  const token = "private-origin-token";
  const account = "private-account";
  const requests: {
    path: string;
    host?: string;
    token?: string;
    account?: string;
    method?: string;
  }[] = [];
  const http = createHTTPServer((request, response) => {
    const path = request.url!;
    requests.push({
      path,
      host: request.headers.host,
      token: request.headers["x-momo-origin-lock"] as string,
      account: request.headers["x-momo-account-id"] as string,
      method: request.method,
    });
    if (broken === "timeout") return;
    if (broken === "redirect") {
      response.writeHead(302, { location: "/healthz" }).end();
      return;
    }
    if (
      request.headers.host !== host ||
      (path !== "/healthz" && request.headers["x-momo-origin-lock"] !== token)
    ) {
      response.writeHead(421).end();
      return;
    }
    response.setHeader(
      "Cache-Control",
      path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : path.startsWith("/api/") || path.startsWith("/healthz")
          ? "no-store"
          : "no-cache",
    );
    if (broken === "cache" && path === "/") response.setHeader("Cache-Control", "private");
    if (broken === "repeated-cache" && path === "/api/auth/me") {
      response.setHeader("Cache-Control", ["no-store", "no-store"]);
    }
    if (path === "/healthz") response.end('{"status":"ok"}');
    else if (path === "/healthz/details") response.end('{"database":"ok"}');
    else if (path === "/api/auth/me")
      response.end(JSON.stringify({ accountId: request.headers["x-momo-account-id"] }));
    else if (path === "/assets/missing.js") response.writeHead(405).end();
    else if (path === "/openapi.yaml") response.writeHead(404).end();
    else response.end('<script src="/assets/app.js"></script>');
  });
  const http2 = createHTTP2Server();
  const sessions = new Set<import("node:http2").ServerHttp2Session>();
  http2.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });
  const h2Requests: import("node:http2").IncomingHttpHeaders[] = [];
  http2.on("stream", (stream: ServerHttp2Stream, headers) => {
    h2Requests.push(headers);
    if (broken === "http2-timeout") return;
    stream.respond({ ":status": broken === "http2-status" ? 503 : 200 });
    stream.end("healthy");
  });
  await Promise.all([
    new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => http2.listen(0, "127.0.0.1", resolve)),
  ]);
  // A cleartext runtime serves HTTP/1.1 and HTTP/2 prior knowledge on one port.
  // Route the actual wire preface to real protocol servers, without mocking requests.
  const sockets = new Set<Socket>();
  const gateway = createTCPServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", (first) => {
      const port = (
        (first.toString().startsWith("PRI * HTTP/2.0") ? http2 : http).address() as AddressInfo
      ).port;
      const upstream = connect(port, "127.0.0.1", () => {
        upstream.write(first);
        socket.pipe(upstream);
      });
      sockets.add(upstream);
      upstream.on("close", () => {
        sockets.delete(upstream);
        socket.destroy();
      });
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
      upstream.pipe(socket);
    });
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    for (const session of sessions) session.destroy();
    http.closeAllConnections();
    await Promise.all(
      [http, http2, gateway].map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  });
  const baseUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  return {
    requests,
    h2Requests,
    options: {
      baseUrl,
      canonicalHost: host,
      originLockToken: token,
      accountId: account,
      timeoutMs: 2_000,
    },
  };
}

test("runtime scenario sends host, origin and account headers and uses real h2c", async (t) => {
  const server = await fixture(t);
  await runSmoke(server.options);
  assert.equal(server.h2Requests.length, 1);
  assert.equal(server.h2Requests[0]![":authority"], server.options.canonicalHost);
  assert.equal(server.h2Requests[0]![":path"], "/healthz");
  assert.equal(server.h2Requests[0]!["x-momo-origin-lock"], server.options.originLockToken);
  assert(
    server.requests.some(
      (r) => r.path === "/api/auth/me" && r.account === server.options.accountId,
    ),
  );
  assert(server.requests.some((r) => r.path === "/assets/app.js"));
  assert(server.requests.some((r) => r.path === "/assets/missing.js" && r.method === "POST"));
  assert(server.requests.some((r) => r.host === "momo-result.fly.dev"));
  assert(server.requests.some((r) => r.host === "unknown.example"));
  assert(server.requests.some((r) => r.path === "/" && r.token === undefined));
});

for (const [broken, expected] of [
  ["cache", "index cache"],
  ["redirect", "health"],
  ["http2-status", "HTTP/2 health"],
] as const) {
  test(`rejects ${broken} without exposing request or response values`, async (t) => {
    const server = await fixture(t, broken);
    await assert.rejects(runSmoke(server.options), (error) => {
      assert(error instanceof Error);
      assert(error.message.startsWith(expected));
      for (const value of Object.values(server.options).filter((v) => typeof v === "string"))
        assert(!error.message.includes(value));
      return true;
    });
  });
}

for (const broken of ["timeout", "http2-timeout"]) {
  test(`bounds ${broken} and closes clients`, async (t) => {
    const server = await fixture(t, broken);
    const options = { ...server.options, timeoutMs: 50 };
    await assert.rejects(
      broken === "timeout"
        ? runSmoke(options)
        : checkHTTP2(
            `${options.baseUrl}/healthz`,
            options.canonicalHost,
            options.originLockToken,
            options.timeoutMs,
          ),
      /timed out/,
    );
  });
}

test("accepts repeated Cache-Control lines from the API and proxy", async (t) => {
  const server = await fixture(t, "repeated-cache");
  await runSmoke(server.options);
});
