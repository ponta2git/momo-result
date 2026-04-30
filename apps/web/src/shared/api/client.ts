import type { components } from "@/shared/api/generated";
import { normalizeApiErrorResponse, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ApiRequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  formData?: FormData;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

const mutatingMethods = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);
let csrfToken: string | undefined;

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

function buildHeaders(method: HttpMethod, options: ApiRequestOptions): Headers {
  const headers = new Headers(options.headers);
  const devUser = resolveDevUser();

  if (devUser) {
    headers.set("X-Dev-User", devUser);
  }

  if (mutatingMethods.has(method)) {
    if (devUser) {
      headers.set("X-CSRF-Token", "dev");
    } else if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers = buildHeaders(method, options);

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

export type AuthMeResponse = components["schemas"]["AuthMeResponse"];

export async function getAuthMe(): Promise<AuthMeResponse> {
  const response = await apiRequest<AuthMeResponse>("/api/auth/me");
  csrfToken = response.csrfToken ?? undefined;
  return response;
}

export async function logout(): Promise<void> {
  await apiRequest<void>("/api/auth/logout", { method: "POST" });
  csrfToken = undefined;
}
