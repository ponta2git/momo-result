import { PlayerRadarAdminPanel } from "@/features/seriesAnalysisAdmin/PlayerRadarAdminPanel";
import { usePlayerRadarAdminModel } from "@/features/seriesAnalysisAdmin/usePlayerRadarAdminModel";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

export function PlayerRadarAdministration({
  gameTitleId,
  gameTitleName,
  onApplyAccepted,
  applyFinalFocus,
}: {
  gameTitleId: string;
  gameTitleName: string;
  onApplyAccepted?: ((operationId: string) => void) | undefined;
  applyFinalFocus?: (() => HTMLElement | null) | undefined;
}) {
  const page = usePlayerRadarAdminModel(gameTitleId, gameTitleName, onApplyAccepted);
  if (page.model)
    return <PlayerRadarAdminPanel model={page.model} applyFinalFocus={applyFinalFocus} />;
  if (page.error)
    return (
      <Notice
        tone="danger"
        title="採点基準の状態を読み込めません"
        action={
          <Button
            pending={page.refreshing}
            pendingLabel="再読み込み中"
            size="sm"
            onClick={() => void page.refresh()}
          >
            基準の状態を再読み込み
          </Button>
        }
      >
        {page.error.detail}
      </Notice>
    );
  return (
    <div aria-label="採点基準を読み込み中" role="status" className="grid min-w-0 gap-4">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
