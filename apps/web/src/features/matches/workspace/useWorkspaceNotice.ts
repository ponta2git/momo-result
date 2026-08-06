import { useCallback } from "react";

import { showToast } from "@/shared/ui/feedback/Toast";

export type WorkspaceNoticeTone = "info" | "success" | "warning";

export function useWorkspaceNotice() {
  const notify = useCallback((message: string, tone: WorkspaceNoticeTone = "info") => {
    showToast({ title: message, tone });
  }, []);

  return { notify };
}
