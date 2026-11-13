import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";

export const workspaceSampleStatus = {
  label: "サンプルの読み取り結果で表示中",
  tone: "warning",
} as const;

/**
 * The source image sits beside the editor once the editor area fits the folded score table
 * (50.5rem), a 1rem gap, and a 27.5rem image, which a 1366px screen leaves even beside a classic
 * scrollbar. The image takes the spare width first, up to 46rem, and the table the rest, so a
 * 1920px screen also unfolds the table to one line (67rem). Viewport width cannot see the page
 * padding, so the editor area is the `match-editor` container.
 */
export const matchWorkspaceSideBySideColumnsClass =
  "@min-[79rem]/match-editor:grid-cols-[minmax(50.5rem,1fr)_minmax(27.5rem,46rem)]";

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
