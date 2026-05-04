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
    detail: text || response.statusText || "API request failed.",
  };
}

export function normalizeUnknownApiError(error: unknown): NormalizedApiError {
  if (error && typeof error === "object" && (error as NormalizedApiError).kind === "api") {
    return error as NormalizedApiError;
  }

  return {
    kind: "api",
    title: "Network error",
    detail:
      error instanceof Error ? error.message : "API request failed before receiving a response.",
  };
}

/**
 * 任意の未処理エラーを UI に表示するメッセージへ純関数として変換する。
 *
 * 優先順位は `detail → title → fallback`。すべてのページで同じ規則を使うため、
 * `normalizeUnknownApiError(...).detail || ... || "..."` の重複を解消する。
 */
export function formatApiError(error: unknown, fallback: string): string {
  const normalized = normalizeUnknownApiError(error);
  return normalized.detail || normalized.title || fallback;
}
