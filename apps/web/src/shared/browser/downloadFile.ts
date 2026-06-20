import type { ApiDownloadResult } from "@/shared/api/client";

export function triggerBrowserDownload(result: ApiDownloadResult): void {
  const url = URL.createObjectURL(result.blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
