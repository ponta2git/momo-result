import type { ApiDownloadResult } from "@/shared/api/client";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";

import { exportMatches } from "./exportApi";
import type { ExportDownloadOutcome, ExportMatchesRequest } from "./exportTypes";

export const DEFAULT_EXPORT_TIMEOUT_MS = 30_000;
export const DEFAULT_EXPORT_SLOW_THRESHOLD_MS = 10_000;

const timeoutTitle = "出力が完了しませんでした";
const timeoutDetail =
  "通信またはサーバー処理が想定より長くかかっています。条件を確認してもう一度お試しください。";

export function triggerDownload(result: ApiDownloadResult): void {
  const url = URL.createObjectURL(result.blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadExportMatches(
  request: ExportMatchesRequest,
  options: { timeoutMs?: number } = {},
): Promise<ExportDownloadOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const result = await exportMatches(request, { signal: controller.signal });
    triggerDownload(result);
    return {
      contentType: result.contentType,
      fileName: result.fileName,
      format: request.format,
      kind: "download_started",
      startedAt: new Date().toISOString(),
    };
  } catch (error) {
    const normalized = normalizeUnknownApiError(error);
    if (timedOut || normalized.status === 408 || normalized.status === 504) {
      return {
        detail: timeoutDetail,
        kind: "timeout",
        title: timeoutTitle,
      };
    }
    return {
      error: normalized,
      kind: "failed",
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
