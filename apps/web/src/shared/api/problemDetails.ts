import type { components } from "@/shared/api/generated";

export type ProblemDetails = components["schemas"]["ProblemDetails"];

export type NormalizedApiError = {
  kind: "api";
  status?: number;
  title: string;
  detail: string;
  code?: string;
  category?: "idempotency_in_progress" | "idempotency_payload_mismatch" | "payload_too_large";
  problem?: ProblemDetails;
};

const idempotencyInProgressMessage =
  "同じ操作を処理中です。しばらく待ってから、同じ内容でもう一度実行してください。";
const idempotencyPayloadMismatchMessage =
  "送信内容が変更されています。現在の内容でもう一度実行してください。";
const payloadTooLargeMessage =
  "送信内容が大きすぎます。入力内容を減らすか、画像ファイルは画像アップロードから送信してください。";

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
      const category = categorizeProblem(body);
      return {
        kind: "api",
        status: body.status,
        title: body.title,
        detail: body.detail,
        code: body.code,
        ...(category ? { category } : {}),
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

function categorizeProblem(
  problem: Pick<ProblemDetails, "code" | "detail" | "status">,
): NormalizedApiError["category"] {
  if (problem.status === 413 || problem.code === "PAYLOAD_TOO_LARGE") {
    return "payload_too_large";
  }
  if (problem.code === "IDEMPOTENCY_IN_PROGRESS") {
    return "idempotency_in_progress";
  }
  if (problem.code === "IDEMPOTENCY_PAYLOAD_MISMATCH") {
    return "idempotency_payload_mismatch";
  }
  if (isIdempotencyConflictShape(problem)) {
    return problem.detail.includes("different request payload")
      ? "idempotency_payload_mismatch"
      : "idempotency_in_progress";
  }
  return undefined;
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
  return (
    error.category === "idempotency_in_progress" ||
    error.category === "idempotency_payload_mismatch"
  );
}

function isIdempotencyConflictShape(
  problem: Pick<NormalizedApiError, "code" | "detail" | "status">,
): boolean {
  return (
    (problem.code === "IDEMPOTENCY_CONFLICT" || problem.code === "CONFLICT") &&
    problem.status === 409 &&
    problem.detail.includes("Idempotency-Key")
  );
}

export function normalizeDisplayApiError(
  error: unknown,
  fallbackTitle = "通信に失敗しました",
): NormalizedApiError {
  const normalized = normalizeUnknownApiError(error);
  if (normalized.category === "idempotency_in_progress") {
    return {
      ...normalized,
      detail: idempotencyInProgressMessage,
      title: fallbackTitle,
    };
  }
  if (normalized.category === "idempotency_payload_mismatch") {
    return {
      ...normalized,
      detail: idempotencyPayloadMismatchMessage,
      title: fallbackTitle,
    };
  }
  if (normalized.category === "payload_too_large") {
    return {
      ...normalized,
      detail: payloadTooLargeMessage,
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
