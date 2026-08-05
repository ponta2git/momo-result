import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

import type { ExportDownloadResultView } from "./exportViewModel";

type ExportDownloadResultProps = {
  onRetry?: (() => void) | undefined;
  result?: ExportDownloadResultView | undefined;
};

export function ExportDownloadResult({ onRetry, result }: ExportDownloadResultProps) {
  if (!result) return null;

  if (result.kind === "success") {
    return (
      <Notice className="momo-enter" tone="success" title="ダウンロードを開始しました">
        {result.fileName}
      </Notice>
    );
  }

  if (result.kind === "timeout") {
    return (
      <Notice
        action={
          onRetry ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              もう一度試す
            </Button>
          ) : undefined
        }
        className="momo-enter"
        tone="warning"
        title={result.title}
      >
        {result.detail}
      </Notice>
    );
  }

  return (
    <Notice
      action={
        onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            もう一度試す
          </Button>
        ) : undefined
      }
      className="momo-enter"
      tone="danger"
      title={result.title}
    >
      {result.detail}
    </Notice>
  );
}
