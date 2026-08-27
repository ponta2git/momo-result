import type { components } from "@/shared/api/generated";

export type ProblemDetails = components["schemas"]["ProblemDetails"];

export type NormalizedApiError = {
  kind: "api";
  status?: number;
  title: string;
  detail: string;
  code?: string;
  category?:
    | "analysis_client_upgrade_required"
    | "idempotency_in_progress"
    | "idempotency_payload_mismatch"
    | "payload_too_large";
  problem?: ProblemDetails;
};

const idempotencyInProgressMessage =
  "同じ操作を処理中です。少し待ってから、同じ内容で再実行してください。";
const idempotencyPayloadMismatchMessage =
  "送信内容が変わっています。現在の内容で再実行してください。";
const payloadTooLargeMessage =
  "送信内容が大きすぎます。入力を減らすか、画像アップロードを使ってください。";

const problemDisplayMessages: Readonly<Record<string, string>> = {
  ANALYSIS_ARTIFACT_EXPIRED:
    "この分析結果は利用できなくなりました。最新の結果を読み込んでください。",
  ANALYSIS_CLIENT_UPGRADE_REQUIRED: "最新の分析結果を使うため、ページを再読み込みしてください。",
  ANALYSIS_NO_ELIGIBLE_TITLES: "分析できる作品がありません。",
  ANALYSIS_READ_BUSY: "分析結果を読み込めません。少し待ってから、もう一度実行してください。",
  ANALYSIS_SCOPE_NOT_FOUND: "指定された分析対象が見つかりませんでした。",
  ANALYSIS_SCOPE_NOT_IN_ARTIFACT: "指定された条件の分析結果は、現在の結果に含まれていません。",
  ANALYSIS_STATE_UNAVAILABLE:
    "分析状態を読み込めません。少し待ってから、もう一度実行してください。",
  BAD_REQUEST: "入力内容を確認してください。",
  CONFLICT: "保存済みの状態が変わっています。内容を確認して、もう一度実行してください。",
  MATCH_NOTE_VERSION_CONFLICT:
    "試合メモが別の利用者に更新されました。最新の内容を確認してください。",
  DEPENDENCY_FAILED: "現在処理を完了できません。少し待ってから、もう一度実行してください。",
  FORBIDDEN: "この操作を行う権限がありません。",
  INTERNAL_ERROR: "予期しないエラーが発生しました。もう一度お試しください。",
  NOT_FOUND: "指定されたデータが見つかりませんでした。",
  SERVICE_UNAVAILABLE: "現在処理を完了できません。少し待ってから、もう一度実行してください。",
  TOO_MANY_REQUESTS: "操作が集中しています。少し待ってから、もう一度実行してください。",
  UNAUTHORIZED: "ログインが必要です。再度ログインしてください。",
  UNSUPPORTED_MEDIA_TYPE:
    "対応していないファイル形式です。PNG、JPEG、WebPの画像を選択してください。",
  VALIDATION_FAILED: "入力内容を確認してください。",
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
      const category = categorizeProblem(body);
      return {
        kind: "api",
        status: body.status,
        title: "操作を完了できませんでした",
        detail: displayMessageForProblem(body, category),
        code: body.code,
        ...(category ? { category } : {}),
        problem: body,
      };
    }
  }

  await response.text().catch(() => "");
  return {
    kind: "api",
    status: response.status,
    title: "通信に失敗しました",
    detail: "応答を受け取れませんでした。",
  };
}

function displayMessageForProblem(
  problem: Pick<ProblemDetails, "code" | "detail" | "status">,
  category: NormalizedApiError["category"],
): string {
  if (category === "idempotency_in_progress") {
    return idempotencyInProgressMessage;
  }
  if (category === "idempotency_payload_mismatch") {
    return idempotencyPayloadMismatchMessage;
  }
  if (category === "payload_too_large") {
    return payloadTooLargeMessage;
  }
  return problemDisplayMessages[String(problem.code)] ?? "操作を完了できませんでした。";
}

function categorizeProblem(
  problem: Pick<ProblemDetails, "code" | "detail" | "status">,
): NormalizedApiError["category"] {
  if (String(problem.code) === "ANALYSIS_CLIENT_UPGRADE_REQUIRED") {
    return "analysis_client_upgrade_required";
  }
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

export function isAnalysisClientUpgradeRequired(error: unknown): boolean {
  return normalizeUnknownApiError(error).category === "analysis_client_upgrade_required";
}

export function isAnalysisArtifactExpired(error: unknown): boolean {
  return normalizeUnknownApiError(error).code === "ANALYSIS_ARTIFACT_EXPIRED";
}

export function normalizeUnknownApiError(error: unknown): NormalizedApiError {
  if (error && typeof error === "object" && (error as NormalizedApiError).kind === "api") {
    return error as NormalizedApiError;
  }

  return {
    kind: "api",
    title: "通信に失敗しました",
    detail: "応答を受け取れませんでした。",
  };
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
