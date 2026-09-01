import { RotateCcw } from "lucide-react";

import type { MatchWorkspaceRecoveryModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

function savedAtLabel(savedAt: string): string {
  return formatDateTimeLong(savedAt, "前回");
}

export function MatchWorkspaceRecoveryNotice({ model }: { model: MatchWorkspaceRecoveryModel }) {
  return (
    <Notice
      action={
        <div className="flex flex-wrap gap-2">
          <Button icon={<RotateCcw aria-hidden="true" />} onClick={model.onRestore}>
            一時保存を復元
          </Button>
          <Button variant="secondary" onClick={model.onDiscard}>
            一時保存を削除
          </Button>
        </div>
      }
      role="status"
      title="前回の一時保存があります"
      tone="info"
    >
      {savedAtLabel(model.savedAt)}時点の入力内容とOCR確認状況を、このタブに保持しています。
    </Notice>
  );
}
