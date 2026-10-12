import { useCallback, useTransition } from "react";
import { useNavigate } from "react-router-dom";

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import type { WorkspaceNoticeTone } from "@/features/matches/workspace/useWorkspaceNotice";

export function useMatchWorkspaceMasterNavigation({
  canManageMasters,
  canNavigateToMasters,
  mode,
  notify,
  saveBeforeNavigate,
}: {
  canManageMasters: boolean;
  canNavigateToMasters: () => boolean;
  mode: WorkspaceMode;
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  saveBeforeNavigate: () => boolean;
}) {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();
  const available = canManageMasters && (mode === "review" || mode === "create");
  const navigateToMasters = useCallback(() => {
    if (!available || !canNavigateToMasters()) return;
    if (!saveBeforeNavigate()) {
      notify(
        "入力内容を一時保存できなかったため、設定管理へ移動しませんでした。もう一度お試しください。",
        "warning",
      );
      return;
    }
    startTransition(async () => {
      await navigate("/admin/masters");
    });
  }, [available, canNavigateToMasters, navigate, notify, saveBeforeNavigate]);

  return { available, isPending, navigateToMasters };
}
