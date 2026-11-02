import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";

export const workspaceSampleStatus = {
  label: "サンプルの読み取り結果で表示中",
  tone: "warning",
} as const;

/**
 * Reserves the workspace width for entry that keeps OCR source images beside the editor.
 * Manual entry, editing, and the sample review have no source panel, so they use the default.
 */
export function matchWorkspacePageWidth({
  matchDraftId,
  mode,
  sample = false,
}: {
  matchDraftId?: string | undefined;
  mode: "create" | "edit" | "review";
  sample?: boolean | undefined;
}): PageFrameWidth {
  return mode !== "edit" && matchDraftId && !sample ? "workspace" : "default";
}
