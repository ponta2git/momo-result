import { clearCsrfToken, getCsrfToken, setCsrfToken } from "@/shared/api/csrfTokenStore";
import type { components } from "@/shared/api/generated";
import { normalizeApiErrorResponse, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ApiRequestOptions = {
  idempotency?: "auto" | "none" | { key: string } | undefined;
  method?: HttpMethod;
  body?: unknown;
  formData?: FormData;
  headers?: HeadersInit;
  idempotencyKey?: string | undefined;
  signal?: AbortSignal;
};

export type IdempotencyRequestOptions = {
  idempotencyKey?: string | undefined;
};

export type ApiDownloadResult = {
  blob: Blob;
  fileName: string;
  contentType: string;
};

const mutatingMethods = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);
const jsonIdempotencyTargets: ReadonlyArray<{
  method: HttpMethod;
  pathname: RegExp;
}> = [
  { method: "POST", pathname: /^\/api\/held-events$/u },
  { method: "POST", pathname: /^\/api\/match-drafts$/u },
  { method: "POST", pathname: /^\/api\/match-drafts\/[^/]+\/cancel$/u },
  { method: "PATCH", pathname: /^\/api\/match-drafts\/[^/]+$/u },
  { method: "POST", pathname: /^\/api\/matches$/u },
  { method: "POST", pathname: /^\/api\/ocr-jobs$/u },
  { method: "POST", pathname: /^\/api\/game-titles$/u },
  { method: "POST", pathname: /^\/api\/map-masters$/u },
  { method: "POST", pathname: /^\/api\/season-masters$/u },
  { method: "POST", pathname: /^\/api\/member-aliases$/u },
  { method: "POST", pathname: /^\/api\/admin\/login-accounts$/u },
];

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

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function requestPathname(path: string): string {
  try {
    return new URL(path, "https://momo-result.local").pathname;
  } catch {
    return path.split("?")[0] ?? path;
  }
}

function shouldAttachIdempotencyKey(
  path: string,
  method: HttpMethod,
  options: ApiRequestOptions,
): boolean {
  if (options.formData !== undefined) {
    return false;
  }
  if (options.idempotency === "none") {
    return false;
  }
  if (options.idempotency === "auto" || typeof options.idempotency === "object") {
    return mutatingMethods.has(method);
  }
  if (options.idempotencyKey !== undefined) {
    return mutatingMethods.has(method);
  }
  const pathname = requestPathname(path);
  return jsonIdempotencyTargets.some(
    (target) => target.method === method && target.pathname.test(pathname),
  );
}

function resolveIdempotencyKey(options: ApiRequestOptions): string {
  if (typeof options.idempotency === "object") {
    return options.idempotency.key;
  }
  return options.idempotencyKey ?? createIdempotencyKey();
}

function buildHeaders(path: string, method: HttpMethod, options: ApiRequestOptions): Headers {
  const headers = new Headers(options.headers);
  const devUser = resolveDevUser();

  if (devUser) {
    headers.set("X-Dev-User", devUser);
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

  if (shouldAttachIdempotencyKey(path, method, options) && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", resolveIdempotencyKey(options));
  }

  return headers;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers = buildHeaders(path, method, options);

  try {
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

    const response = await fetch(path, init);

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
  const headers = buildHeaders(path, "GET", options);

  try {
    const init: RequestInit = {
      method: "GET",
      headers,
      credentials: "include",
    };
    if (options.signal !== undefined) {
      init.signal = options.signal;
    }
    const response = await fetch(path, init);

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

export type AuthMeResponse = components["schemas"]["AuthMeResponse"];
export type LoginAccountListResponse = components["schemas"]["LoginAccountListResponse"];
export type LoginAccountResponse = components["schemas"]["LoginAccountResponse"];
export type CreateLoginAccountRequest = components["schemas"]["CreateLoginAccountRequest"];
export type UpdateLoginAccountRequest = components["schemas"]["UpdateLoginAccountRequest"];

export async function getAuthMe(): Promise<AuthMeResponse> {
  const response = await apiRequest<AuthMeResponse>("/api/auth/me");
  setCsrfToken(response.csrfToken ?? undefined);
  return response;
}

export async function logout(): Promise<void> {
  await apiRequest<void>("/api/auth/logout", { method: "POST" });
  clearCsrfToken();
}

export async function listLoginAccounts(): Promise<LoginAccountListResponse> {
  return apiRequest<LoginAccountListResponse>("/api/admin/login-accounts");
}

export async function createLoginAccount(
  request: CreateLoginAccountRequest,
  options: IdempotencyRequestOptions = {},
): Promise<LoginAccountResponse> {
  return apiRequest<LoginAccountResponse>("/api/admin/login-accounts", {
    method: "POST",
    body: request,
    idempotency: options.idempotencyKey ? { key: options.idempotencyKey } : "auto",
  });
}

export async function updateLoginAccount(
  accountId: string,
  request: UpdateLoginAccountRequest,
): Promise<LoginAccountResponse> {
  return apiRequest<LoginAccountResponse>(
    `/api/admin/login-accounts/${encodeURIComponent(accountId)}`,
    {
      method: "PATCH",
      body: request,
    },
  );
}
