import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import { MatchWorkspaceSkeleton } from "@/shared/workflows/MatchWorkspaceSkeleton";

export function MatchWorkspaceLoading({
  loadingLabel = "試合フォームを読み込み中",
  mode,
  sample = false,
  width,
}: {
  loadingLabel?: string;
  mode: WorkspaceMode;
  sample?: boolean;
  width: PageFrameWidth;
}) {
  return (
    <PageFrame aria-busy="true" aria-label={loadingLabel} width={width}>
      <MatchWorkspaceSkeleton mode={mode} sample={sample} sourcePanel={width === "workspace"} />
    </PageFrame>
  );
}
