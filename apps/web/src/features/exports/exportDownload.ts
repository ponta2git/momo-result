import type { ApiDownloadResult } from "@/shared/api/client";
import { exportMatches } from "@/shared/api/exports";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { triggerBrowserDownload } from "@/shared/browser/downloadFile";

import type { ExportDownloadOutcome, ExportMatchesRequest } from "./exportTypes";

export const DEFAULT_EXPORT_TIMEOUT_MS = 30_000;
export const DEFAULT_EXPORT_SLOW_THRESHOLD_MS = 10_000;

const timeoutTitle = "出力が完了しませんでした";
const timeoutDetail =
  "通信または処理に時間がかかっています。条件を確認して、もう一度お試しください。";

export function triggerDownload(result: ApiDownloadResult): void {
  triggerBrowserDownload(result);
}

export async function downloadExportMatches(
  request: ExportMatchesRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ExportDownloadOutcome> {
  const { signal } = options;
  if (signal?.aborted) return { kind: "cancelled" };
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const result = await exportMatches(request, { signal: controller.signal });
    // Even a transport that completed after abort must not initiate a download for an old scope.
    if (signal?.aborted) return { kind: "cancelled" };
    if (timedOut) return { detail: timeoutDetail, kind: "timeout", title: timeoutTitle };
    triggerDownload(result);
    return {
      contentType: result.contentType,
      fileName: result.fileName,
      format: request.format,
      kind: "download_started",
      startedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (signal?.aborted) return { kind: "cancelled" };
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
    signal?.removeEventListener("abort", cancel);
  }
}
