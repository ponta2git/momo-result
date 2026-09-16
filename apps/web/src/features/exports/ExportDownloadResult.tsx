import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

import type { ExportDownloadResultView } from "./exportViewModel";

type ExportDownloadResultProps = {
  onRetry?: (() => void) | undefined;
  result?: ExportDownloadResultView | undefined;
  pending?: boolean;
};

export function ExportDownloadResult({
  onRetry,
  result,
  pending = false,
}: ExportDownloadResultProps) {
  if (!result) return null;

  if (result.kind === "success") {
    return (
      <Notice tone="success" title="ダウンロードを開始しました">
        {result.fileName}
      </Notice>
    );
  }

  if (result.kind === "timeout") {
    return (
      <Notice
        action={
          onRetry ? (
            <Button
              pending={pending}
              pendingLabel="作成中…"
              size="sm"
              variant="secondary"
              onClick={onRetry}
            >
              もう一度試す
            </Button>
          ) : undefined
        }
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
          <Button
            pending={pending}
            pendingLabel="作成中…"
            size="sm"
            variant="secondary"
            onClick={onRetry}
          >
            もう一度試す
          </Button>
        ) : undefined
      }
      tone="danger"
      title={result.title}
    >
      {result.detail}
    </Notice>
  );
}
