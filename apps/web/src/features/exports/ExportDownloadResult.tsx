import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

import type { ExportDownloadResultView } from "./exportViewModel";

type ExportDownloadResultProps = {
  onRetry?: (() => void) | undefined;
  result?: ExportDownloadResultView | undefined;
};

export function ExportDownloadResult({ onRetry, result }: ExportDownloadResultProps) {
  if (!result) return null;

  if (result.kind === "success") return null;

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
      tone="danger"
      title={result.title}
    >
      {result.detail}
    </Notice>
  );
}
