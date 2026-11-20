import { failure } from "./response.ts";

export interface ProxyEnvironment {
  API_ORIGIN: string;
  MOMO_ORIGIN_LOCK_TOKEN: string;
  MOMO_ALLOW_LOCAL_ORIGIN?: string;
}

// workerd infers Content-Length from the stream supplied to fetch.
type UploadStream = ReadableWritablePair<Uint8Array, Uint8Array>;
declare const FixedLengthStream: new (length: number) => UploadStream;
declare const IdentityTransformStream: new () => UploadStream;

const responseHeaderTimeout = 30_000;
const privateSourceImage = /^\/api\/match-drafts\/[^/]+\/source-images(?:\.zip|\/[^/]+)$/u;
const excludedHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "forwarded",
  "x-real-ip",
  "true-client-ip",
  "x-momo-runtime-probe",
  "x-momo-origin-lock",
  "x-momo-client-ip",
]);

function apiOrigin(env: ProxyEnvironment): URL | undefined {
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

function upstreamHeaders(incoming: Headers, clientIP: string, token: string): Headers {
  const connection = incoming.get("connection");
  const nominated = connection
    ? new Set(
        connection
          .toLowerCase()
          .split(",")
          .map((name) => name.trim()),
      )
    : undefined;
  const outgoing = new Headers();
  for (const [name, value] of incoming) {
    if (
      !excludedHeaders.has(name) &&
      !name.startsWith("x-forwarded-") &&
      !name.startsWith("cf-") &&
      !nominated?.has(name)
    )
      outgoing.append(name, value);
  }
  outgoing.set("X-Momo-Origin-Lock", token);
  outgoing.set("X-Momo-Client-IP", clientIP);
  return outgoing;
}

function uploadStream(headers: Headers): UploadStream {
  const field = headers.get("Content-Length");
  const length = field === null ? NaN : Number(field);
  return Number.isSafeInteger(length) && length >= 0
    ? new FixedLengthStream(length)
    : new IdentityTransformStream();
}

export async function proxy(request: Request, env: ProxyEnvironment, url: URL, path: string) {
  const origin = apiOrigin(env);
  const clientIP = request.headers.get("CF-Connecting-IP");
  if (!origin || !clientIP) return failure(503);
  origin.pathname = url.pathname;
  origin.search = url.search;

  // The deadline measures the upstream wait after upload EOF. A client disconnect
  // also cancels the upstream fetch, including its response body after headers.
  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let upload: AbortController | undefined;
  const startDeadline = () => {
    if (!upload?.signal.aborted) timer = setTimeout(() => deadline.abort(), responseHeaderTimeout);
  };

  try {
    let body: ReadableStream<Uint8Array> | null = null;
    if (request.body) {
      upload = new AbortController();
      const stream = uploadStream(request.headers);
      body = stream.readable;
      void request.body
        .pipeTo(stream.writable, { signal: AbortSignal.any([request.signal, upload.signal]) })
        .then(startDeadline, () => {
          // fetch observes stream errors. Early upstream responses also cancel this pipe.
        });
    } else {
      startDeadline();
    }

    const upstream = await fetch(origin, {
      method: request.method,
      headers: upstreamHeaders(request.headers, clientIP, env.MOMO_ORIGIN_LOCK_TOKEN),
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.any([request.signal, deadline.signal]),
    });
    const response = new Response(upstream.body, upstream);
    response.headers.set(
      "Cache-Control",
      privateSourceImage.test(path) ? "private, no-store" : "no-store",
    );
    return response;
  } catch {
    // Transport errors may carry private request details.
    return failure(deadline.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
    upload?.abort();
  }
}
