import { connect } from "node:http2";
import { request as requestHTTP } from "node:http";
import { request as requestHTTPS } from "node:https";

export interface SmokeOptions {
  baseUrl: string;
  canonicalHost: string;
  originLockToken: string;
  accountId: string;
  timeoutMs?: number;
}

class SmokeFailure extends Error {}

export async function runSmoke(options: SmokeOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const trusted: Record<string, string> = {
    Host: options.canonicalHost,
    "X-Momo-Origin-Lock": options.originLockToken,
  };
  const authenticated = { ...trusted, "X-Momo-Account-Id": options.accountId };
  async function request(label: string, path: string, headers = trusted, method = "GET") {
    try {
      const url = new URL(`${baseUrl}${path}`);
      const send = url.protocol === "https:" ? requestHTTPS : requestHTTP;
      return await new Promise<{
        status: number;
        headers: Record<string, string[] | undefined>;
        body: string;
      }>((resolve, reject) => {
        // Native fetch drops Host overrides; this scenario must test virtual-host routing.
        const outgoing = send(
          url,
          { method, headers, agent: false, signal: AbortSignal.timeout(timeoutMs) },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("error", reject);
            response.on("end", () =>
              resolve({ status: response.statusCode!, headers: response.headersDistinct, body }),
            );
          },
        );
        const connectionTimer = setTimeout(
          () => outgoing.destroy(new Error()),
          Math.min(2_000, timeoutMs),
        );
        outgoing.on("socket", (socket) => {
          socket.once(url.protocol === "https:" ? "secureConnect" : "connect", () =>
            clearTimeout(connectionTimer),
          );
        });
        outgoing.on("close", () => clearTimeout(connectionTimer));
        outgoing.on("error", reject);
        outgoing.end();
      });
    } catch {
      throw new SmokeFailure(`${label}: request failed or timed out`);
    }
  }
  function expect(condition: boolean, label: string) {
    if (!condition) throw new SmokeFailure(`${label}: unexpected response`);
  }
  async function body(label: string, path: string, expected: string) {
    const response = await request(label, path, authenticated);
    expect(response.status < 400 && response.body.includes(expected), label);
  }
  async function status(
    label: string,
    path: string,
    expected: number,
    headers = trusted,
    method = "GET",
  ) {
    expect((await request(label, path, headers, method)).status === expected, label);
  }
  async function header(label: string, path: string, expected: string) {
    const response = await request(label, path, authenticated);
    // API and proxy may each emit Cache-Control. Preserve curl's per-line match
    // instead of comparing Node's comma-joined representation of repeated headers.
    expect(
      response.headers["cache-control"]?.some((value) => value.toLowerCase() === expected) === true,
      label,
    );
  }

  await body("health", "/healthz", '"status":"ok"');
  await checkHTTP2(`${baseUrl}/healthz`, options.canonicalHost, options.originLockToken, timeoutMs);
  await body("database health", "/healthz/details", '"database":"ok"');
  await body("redis health", "/healthz/details", '"redis":"ok"');
  await body("account authentication", "/api/auth/me", `"accountId":"${options.accountId}"`);
  await status("index", "/", 200);
  await status("SPA deep link", "/matches/e2e-deep-link", 200);
  await status("asset method rejection", "/assets/missing.js", 405, trusted, "POST");
  await status("OpenAPI isolation", "/openapi.yaml", 404);

  const index = await request("built asset discovery", "/");
  const assetPath = index.body.match(/\/assets\/[^"\s<>]+/)?.[0];
  expect(index.status < 400 && assetPath !== undefined, "built asset discovery");
  await header("index cache", "/", "no-cache");
  await header("SPA cache", "/matches/e2e-deep-link", "no-cache");
  await header("asset cache", assetPath!, "public, max-age=31536000, immutable");
  await header("health cache", "/healthz", "no-store");
  await header("account cache", "/api/auth/me", "no-store");
  await status("missing origin lock rejection", "/", 421, { Host: options.canonicalHost });
  await status("provider host rejection", "/", 421, { ...trusted, Host: "momo-result.fly.dev" });
  await status("unknown host rejection", "/", 421, { ...trusted, Host: "unknown.example" });
  await status("unlocked health", "/healthz", 200, { Host: options.canonicalHost });
}

export async function checkHTTP2(
  url: string,
  host: string,
  token: string,
  timeoutMs = 5_000,
): Promise<void> {
  try {
    const endpoint = new URL(url);
    const session = connect(endpoint.origin);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connectionTimer = setTimeout(
      () => session.destroy(new Error()),
      Math.min(2_000, timeoutMs),
    );
    session.once("connect", () => clearTimeout(connectionTimer));
    try {
      await new Promise<void>((resolve, reject) => {
        // Total elapsed deadline, rather than an idle timeout that traffic can reset.
        timer = setTimeout(() => reject(new Error()), timeoutMs);
        const finish = (error?: Error) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        session.on("error", finish);
        const stream = session.request({
          ":method": "GET",
          ":path": endpoint.pathname + endpoint.search,
          ":authority": host,
          "x-momo-origin-lock": token,
        });
        let status: number | undefined;
        stream.on("response", (headers) => {
          status = headers[":status"];
        });
        stream.on("error", finish);
        stream.on("end", () => finish(status === 200 ? undefined : new Error()));
        stream.resume();
        stream.end();
      });
    } finally {
      clearTimeout(timer);
      clearTimeout(connectionTimer);
      session.destroy();
    }
  } catch {
    throw new SmokeFailure(
      "HTTP/2 health: request failed, timed out, or returned a non-200 status",
    );
  }
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 2) throw new SmokeFailure("runtime smoke accepts no arguments");
    await runSmoke({
      baseUrl: process.env.APP_BASE_URL || "http://127.0.0.1:8080",
      accountId: process.env.DEV_ACCOUNT_ID || "account_ponta",
      canonicalHost: process.env.MOMO_CANONICAL_HOST || "momo-result.ponta.me",
      originLockToken: process.env.MOMO_ORIGIN_LOCK_TOKEN || "dev-origin-lock",
    });
  } catch (error) {
    // Never print transport errors, target URLs, headers, or response bodies.
    console.error(error instanceof SmokeFailure ? error.message : "runtime smoke failed");
    process.exitCode = 1;
  }
}
