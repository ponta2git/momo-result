import { useCallback, useEffect, useState } from "react";

import { showToast } from "@/shared/ui/feedback/Toast";

export type WorkspaceNoticeTone = "info" | "success" | "warning";

export function useWorkspaceNotice() {
  const [notice, setNotice] = useState("");

  const notify = useCallback((message: string, tone: WorkspaceNoticeTone = "info") => {
    setNotice(message);
    showToast({ title: message, tone });
  }, []);

  useEffect(() => {
    if (notice === "") {
      return;
    }
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return { notice, notify };
}
