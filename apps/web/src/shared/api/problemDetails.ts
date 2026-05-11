import type { components } from "@/shared/api/generated";

export type ProblemDetails = components["schemas"]["ProblemDetails"];

export type NormalizedApiError = {
  kind: "api";
  status?: number;
  title: string;
  detail: string;
  code?: string;
  problem?: ProblemDetails;
};

const idempotencyConflictMessage = "内部エラーが発生しました。ページを再読み込みしてください。";

function isProblemDetails(value: unknown): value is ProblemDetails {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["type"] === "string" &&
    typeof candidate["title"] === "string" &&
    typeof candidate["status"] === "number" &&
    typeof candidate["detail"] === "string" &&
    typeof candidate["code"] === "string"
  );
}

export async function normalizeApiErrorResponse(response: Response): Promise<NormalizedApiError> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body: unknown = await response.json().catch(() => undefined);
    if (isProblemDetails(body)) {
      return {
        kind: "api",
        status: body.status,
        title: body.title,
        detail: body.detail,
        code: body.code,
        problem: body,
      };
    }
  }

  const text = await response.text().catch(() => "");
  return {
    kind: "api",
    status: response.status,
    title: `HTTP ${response.status}`,
    detail: text || response.statusText || "通信に失敗しました。",
  };
}

export function normalizeUnknownApiError(error: unknown): NormalizedApiError {
  if (error && typeof error === "object" && (error as NormalizedApiError).kind === "api") {
    return error as NormalizedApiError;
  }

  return {
    kind: "api",
    title: "通信に失敗しました",
    detail: error instanceof Error ? error.message : "応答を受け取れませんでした。",
  };
}

export function isIdempotencyConflict(error: NormalizedApiError): boolean {
  return error.code === "IDEMPOTENCY_CONFLICT";
}

function logIdempotencyConflict(error: NormalizedApiError): void {
  // oxlint-disable-next-line no-console -- API contract asks us to keep this client-logic signal out of UI but visible in logs.
  console.warn("Idempotency-Key conflict", {
    code: error.code,
    detail: error.detail,
    status: error.status,
    title: error.title,
  });
}

export function normalizeDisplayApiError(
  error: unknown,
  fallbackTitle = "通信に失敗しました",
): NormalizedApiError {
  const normalized = normalizeUnknownApiError(error);
  if (isIdempotencyConflict(normalized)) {
    logIdempotencyConflict(normalized);
    return {
      ...normalized,
      detail: idempotencyConflictMessage,
      title: fallbackTitle,
    };
  }
  return normalized;
}

/**
 * 任意の未処理エラーを UI に表示するメッセージへ純関数として変換する。
 *
 * 優先順位は `detail → title → fallback`。すべてのページで同じ規則を使うため、
 * `normalizeUnknownApiError(...).detail || ... || "..."` の重複を解消する。
 */
export function formatApiError(error: unknown, fallback: string): string {
  const normalized = normalizeDisplayApiError(error, fallback);
  return normalized.detail || normalized.title || fallback;
}
