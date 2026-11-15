interface Environment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API_ORIGIN: string;
  MOMO_ORIGIN_LOCK_TOKEN: string;
  MOMO_ALLOW_LOCAL_ORIGIN?: string;
}

// Workers uses the native stream's length to retain Content-Length on fetch.
declare const FixedLengthStream: new (
  length: number,
) => ReadableWritablePair<Uint8Array, Uint8Array>;

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};
const contentSecurityPolicy =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
const hopByHopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function failure(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

function apiOrigin(env: Environment): URL | undefined {
  try {
    const origin = new URL(env.API_ORIGIN);
    const local =
      env.MOMO_ALLOW_LOCAL_ORIGIN === "true" &&
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (
      (origin.protocol !== "https:" && !local) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      !/^[\x21-\x7e]{32,}$/u.test(env.MOMO_ORIGIN_LOCK_TOKEN ?? "")
    )
      return undefined;
    return origin;
  } catch {
    return undefined;
  }
}

async function proxy(request: Request, env: Environment, path: string) {
  const origin = apiOrigin(env);
  const clientIP = request.headers.get("CF-Connecting-IP");
  if (!origin || !clientIP) return failure(503);
  const url = new URL(request.url);
  // Start from the configured authority, so no public request port can survive.
  origin.pathname = url.pathname;
  origin.search = url.search;
  const headers = new Headers();
  const connectionHeaders = new Set(
    request.headers
      .get("connection")
      ?.toLowerCase()
      .split(",")
      .map((name) => name.trim()),
  );
  // Copy only end-to-end fields. Iterating a separate collection avoids skipping
  // adjacent spoofed headers when Headers is modified during iteration.
  for (const [name, value] of request.headers) {
    if (
      name === "host" ||
      name === "forwarded" ||
      name.startsWith("x-forwarded-") ||
      name.startsWith("cf-") ||
      name === "x-real-ip" ||
      name === "true-client-ip" ||
      name === "x-momo-runtime-probe" ||
      hopByHopHeaders.includes(name) ||
      connectionHeaders.has(name)
    )
      continue;
    headers.append(name, value);
  }
  headers.set("X-Momo-Origin-Lock", env.MOMO_ORIGIN_LOCK_TOKEN);
  headers.set("X-Momo-Client-IP", clientIP);
  const headerDeadline = new AbortController();
  const upload = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let responseSettled = false;
  const startHeaderDeadline = () => {
    if (!responseSettled) timer = setTimeout(() => headerDeadline.abort(), 30_000);
  };
  try {
    let body: ReadableStream<Uint8Array> | null = null;
    if (request.body) {
      const lengthHeader = request.headers.get("Content-Length");
      const length = lengthHeader === null ? undefined : Number(lengthHeader);
      const stream =
        length !== undefined && Number.isSafeInteger(length) && length >= 0
          ? new FixedLengthStream(length)
          : new TransformStream<Uint8Array, Uint8Array>();
      body = stream.readable;
      // pipeTo preserves backpressure. Its completion means the upload has
      // reached EOF, so a slow client does not consume the response-header wait.
      void request.body
        .pipeTo(stream.writable, {
          signal: AbortSignal.any([request.signal, upload.signal]),
        })
        .then(startHeaderDeadline, () => {
          // The readable side passes upload errors to fetch; cancellation is
          // expected when the origin responds before consuming the whole body.
        });
    } else startHeaderDeadline();
    // Manual redirects keep login cookies and credentials on the intended origin.
    // Forward streams directly: uploads and downloads are never buffered here.
    const outgoing = new Request(
      origin,
      new Request(request, {
        method: request.method,
        body,
        headers,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.any([request.signal, headerDeadline.signal]),
      }),
    );
    const upstream = await fetch(outgoing);
    const response = new Response(upstream.body, upstream);
    response.headers.set(
      "Cache-Control",
      /^\/api\/match-drafts\/[^/]+\/source-images(?:\.zip|\/[^/]+)$/u.test(path)
        ? "private, no-store"
        : "no-store",
    );
    return response;
  } catch {
    // Transport errors can contain the private origin and request headers.
    return failure(headerDeadline.signal.aborted ? 504 : 502);
  } finally {
    // Only the wait for response headers is timed. The incoming request signal
    // remains attached to fetch while its response body streams to the client.
    responseSettled = true;
    clearTimeout(timer);
    upload.abort();
  }
}

async function staticAsset(request: Request, env: Environment, path: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return failure(405);
  const asset = path.startsWith("/assets/");
  let response = await env.ASSETS.fetch(request);
  // Extensionless application routes share the index. Missing files stay 404.
  if (response.status === 404 && !asset && !path.split("/").at(-1)?.includes(".")) {
    const index = new URL(request.url);
    index.pathname = "/index.html";
    response = await env.ASSETS.fetch(new Request(index, request));
  }
  response = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  if (!asset) response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set(
    "Cache-Control",
    response.status >= 400
      ? "no-store"
      : asset
        ? "public, max-age=31536000, immutable"
        : "no-cache",
  );
  return response;
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return failure(400);
    }
    if (
      /(?:^|\/)\./u.test(path) ||
      path === "/openapi.yaml" ||
      /^\/(?:api\/)?__momo_runtime(?:\/|$)/u.test(path)
    )
      return failure(404);
    if (
      path === "/api" ||
      path.startsWith("/api/") ||
      path === "/healthz" ||
      path === "/healthz/details"
    )
      return proxy(request, env, path);
    return staticAsset(request, env, path);
  },
};
