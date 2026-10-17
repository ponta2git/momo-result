import { useCallback, useState } from "react";

import type {
  WorkspaceNotice,
  WorkspaceNoticeTone,
} from "@/features/matches/workspace/matchWorkspacePanelViews";
import { showToast } from "@/shared/ui/feedback/Toast";

export function useWorkspaceNotice() {
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null);
  const notify = useCallback((message: string, tone: WorkspaceNoticeTone = "info") => {
    setNotice(message ? { message, tone } : null);
  }, []);
  const notifyToast = useCallback((message: string, tone: WorkspaceNoticeTone = "info") => {
    showToast({ title: message, tone });
  }, []);

  return { notice, notify, notifyToast };
}
