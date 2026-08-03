import { RotateCcw } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

function savedAtLabel(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return "前回";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function MatchWorkspaceRecoveryNotice({
  savedAt,
  onDiscard,
  onRestore,
}: {
  savedAt: string;
  onDiscard: () => void;
  onRestore: () => void;
}) {
  return (
    <Notice
      action={
        <div className="flex flex-wrap gap-2">
          <Button icon={<RotateCcw aria-hidden="true" className="size-4" />} onClick={onRestore}>
            一時保存を復元
          </Button>
          <Button variant="secondary" onClick={onDiscard}>
            復元せず破棄
          </Button>
        </div>
      }
      role="status"
      title="前回の一時保存があります"
      tone="info"
    >
      {savedAtLabel(savedAt)}時点の入力内容とOCR確認状況を、このタブに保持しています。
    </Notice>
  );
}
