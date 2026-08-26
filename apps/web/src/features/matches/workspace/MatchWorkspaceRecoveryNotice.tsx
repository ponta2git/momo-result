import { RotateCcw } from "lucide-react";

import type { MatchWorkspaceControllerModel } from "@/features/matches/workspace/matchWorkspaceControllerModel";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

function savedAtLabel(savedAt: string): string {
  return formatDateTimeLong(savedAt, "前回");
}

export function MatchWorkspaceRecoveryNotice({
  model,
}: {
  model: NonNullable<MatchWorkspaceControllerModel["editor"]["persistence"]["recovery"]>;
}) {
  return (
    <Notice
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<RotateCcw aria-hidden="true" className="size-4" />}
            onClick={model.onRestore}
          >
            一時保存を復元
          </Button>
          <Button variant="secondary" onClick={model.onDiscard}>
            復元せず破棄
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
