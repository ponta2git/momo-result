import { getCsrfToken } from "@/shared/api/csrfTokenStore";
import { normalizeApiErrorResponse, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ApiRequestOptions = {
  idempotency?: "none" | { key: string } | undefined;
  method?: HttpMethod;
  body?: unknown;
  formData?: FormData;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

export type IdempotencyRequestOptions = {
  idempotencyKey: string;
};

export type ApiSignalOptions = {
  signal?: AbortSignal;
};

export type ApiDownloadResult = {
  blob: Blob;
  fileName: string;
  contentType: string;
};

const mutatingMethods = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);

export type ApiErrorLike = NormalizedApiError;

export function getBuildTimeDevUser(): string | undefined {
  return import.meta.env.DEV ? import.meta.env.VITE_DEV_USER : undefined;
}

export function getStoredDevUser(): string | undefined {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return undefined;
  }
  return window.localStorage.getItem("momoresult.devUser") ?? undefined;
}

export function resolveDevUser(): string | undefined {
  return getBuildTimeDevUser() ?? getStoredDevUser();
}

function shouldAttachIdempotencyKey(method: HttpMethod, options: ApiRequestOptions): boolean {
  if (options.formData !== undefined) {
    return false;
  }
  if (options.idempotency === "none") {
    return false;
  }
  if (typeof options.idempotency === "object") {
    return mutatingMethods.has(method);
  }
  return false;
}

function resolveIdempotencyKey(options: ApiRequestOptions): string {
  if (typeof options.idempotency === "object") {
    return options.idempotency.key;
  }
  throw new Error("Idempotency key was requested but not provided.");
}

function sameOriginRequestPath(path: string): string {
  const baseOrigin =
    typeof window === "undefined" ? "https://momo-result.local" : window.location.origin;
  const parsed = new URL(path, baseOrigin);
  const isRootRelative = path.startsWith("/") && !path.startsWith("//");
  const isSameOriginAbsolute = path.startsWith(`${baseOrigin}/`);

  if (parsed.origin !== baseOrigin || (!isRootRelative && !isSameOriginAbsolute)) {
    throw new Error("API requests must use same-origin paths.");
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function buildHeaders(method: HttpMethod, options: ApiRequestOptions): Headers {
  const headers = new Headers(options.headers);
  const devUser = resolveDevUser();

  if (devUser) {
    headers.set("X-Momo-Account-Id", devUser);
  }

  if (mutatingMethods.has(method)) {
    if (devUser) {
      headers.set("X-CSRF-Token", "dev");
    } else {
      const token = getCsrfToken();
      if (token) {
        headers.set("X-CSRF-Token", token);
      }
    }
  }

  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (shouldAttachIdempotencyKey(method, options) && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", resolveIdempotencyKey(options));
  }

  return headers;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  try {
    const requestPath = sameOriginRequestPath(path);
    const method = options.method ?? "GET";
    const headers = buildHeaders(method, options);
    const init: RequestInit = {
      method,
      headers,
      credentials: "include",
    };
    const body =
      options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    if (body !== undefined) {
      init.body = body;
    }
    if (options.signal !== undefined) {
      init.signal = options.signal;
    }

    const response = await fetch(requestPath, init);

    if (!response.ok) {
      throw await normalizeApiErrorResponse(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    throw normalizeUnknownApiError(error);
  }
}

export async function apiDownload(
  path: string,
  options: Pick<ApiRequestOptions, "headers" | "signal"> = {},
): Promise<ApiDownloadResult> {
  try {
    const requestPath = sameOriginRequestPath(path);
    const headers = buildHeaders("GET", options);
    const init: RequestInit = {
      method: "GET",
      headers,
      credentials: "include",
    };
    if (options.signal !== undefined) {
      init.signal = options.signal;
    }
    const response = await fetch(requestPath, init);

    if (!response.ok) {
      throw await normalizeApiErrorResponse(response);
    }

    const blob = await response.blob();
    return {
      blob,
      fileName: fileNameFromDisposition(response.headers.get("Content-Disposition")),
      contentType: response.headers.get("Content-Type") ?? blob.type,
    };
  } catch (error) {
    throw normalizeUnknownApiError(error);
  }
}

function fileNameFromDisposition(disposition: string | null): string {
  if (!disposition) {
    return "momo-results.csv";
  }
  const quoted = /filename="([^"]+)"/u.exec(disposition);
  if (quoted?.[1]) {
    return quoted[1];
  }
  const plain = /filename=([^;]+)/u.exec(disposition);
  return plain?.[1]?.trim() || "momo-results.csv";
}
