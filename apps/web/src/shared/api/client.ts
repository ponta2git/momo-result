import { getCsrfToken } from "@/shared/api/csrfTokenStore";
import { normalizeApiErrorResponse, normalizeUnknownApiError } from "@/shared/api/problemDetails";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ApiRequestOptions<T = unknown> = {
  idempotency?: "none" | { key: string } | undefined;
  method?: HttpMethod;
  body?: unknown;
  decodeResponse?: (value: unknown) => Promise<T> | T;
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
export const devUserStorageKey = "momoresult.devUser";
export const noDevUserSelectedValue = "__momo_no_dev_user_selected__";

export function getBuildTimeDevUser(): string | undefined {
  return import.meta.env.DEV ? import.meta.env.VITE_DEV_USER : undefined;
}

function getStoredDevUserValue(): string | null | undefined {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage.getItem(devUserStorageKey);
  } catch {
    return undefined;
  }
}

export function getStoredDevUser(): string | undefined {
  const value = getStoredDevUserValue();
  return value === noDevUserSelectedValue ? undefined : (value ?? undefined);
}

export function resolveDevUser(): string | undefined {
  const storedValue = getStoredDevUserValue();
  if (storedValue === noDevUserSelectedValue) {
    return undefined;
  }
  return storedValue ?? getBuildTimeDevUser();
}

function shouldAttachIdempotencyKey(method: HttpMethod, options: ApiRequestOptions): boolean {
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

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

async function executeApiOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // Fetch cancellation is control flow owned by the caller (for example TanStack Query).
    // Replacing it with a display-oriented API error would make a cancelled request look failed.
    if (isAbortError(error)) {
      throw error;
    }
    throw normalizeUnknownApiError(error);
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions<T> = {}): Promise<T> {
  return executeApiOperation(async () => {
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

    const value: unknown = await response.json();
    return options.decodeResponse ? await options.decodeResponse(value) : (value as T);
  });
}

export async function apiDownload(
  path: string,
  options: Pick<ApiRequestOptions<ApiDownloadResult>, "headers" | "signal"> = {},
): Promise<ApiDownloadResult> {
  return executeApiOperation(async () => {
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
  });
}

function fileNameFromDisposition(disposition: string | null): string {
  if (!disposition) {
    return "momo-results.csv";
  }
  const encoded = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/iu.exec(disposition);
  if (encoded?.[1]) {
    const fileName = decodeRfc5987Filename(encoded[1]);
    if (fileName) {
      return fileName;
    }
  }
  const quoted = /filename="([^"]+)"/u.exec(disposition);
  if (quoted?.[1]) {
    return quoted[1];
  }
  const plain = /filename=([^;]+)/u.exec(disposition);
  return plain?.[1]?.trim() || "momo-results.csv";
}

function decodeRfc5987Filename(value: string): string | undefined {
  const trimmed = value.trim();
  const unquoted =
    trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  const match = /^([^']*)'[^']*'(.*)$/u.exec(unquoted);
  if (!match) {
    return undefined;
  }
  const charset = match[1]?.toLowerCase();
  const encoded = match[2];
  if (!encoded || (charset && charset !== "utf-8")) {
    return undefined;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}
