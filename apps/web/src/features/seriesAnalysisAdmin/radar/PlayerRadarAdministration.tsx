import { PlayerRadarAdminPanel } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarAdminPanel";
import { usePlayerRadarAdminModel } from "@/features/seriesAnalysisAdmin/radar/usePlayerRadarAdminModel";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

export function PlayerRadarAdministration({
  gameTitleId,
  gameTitleName,
  active = true,
  onApplyAccepted,
  applyFinalFocus,
}: {
  gameTitleId: string;
  gameTitleName: string;
  active?: boolean;
  onApplyAccepted?: ((operationId: string) => void) | undefined;
  applyFinalFocus?: (() => HTMLElement | null) | undefined;
}) {
  const administration = usePlayerRadarAdminModel(gameTitleId, gameTitleName, onApplyAccepted);
  if (administration.model)
    return (
      <PlayerRadarAdminPanel
        model={administration.model}
        active={active}
        applyFinalFocus={applyFinalFocus}
      />
    );
  if (administration.error)
    return (
      <Notice
        tone="danger"
        title="採点基準の状態を読み込めません"
        action={
          <Button
            pending={administration.refreshing}
            pendingLabel="再読み込み中"
            size="sm"
            onClick={() => void administration.refresh()}
          >
            基準の状態を再読み込み
          </Button>
        }
      >
        {administration.error.detail}
      </Notice>
    );
  return (
    <div aria-label="採点基準を読み込み中" role="status" className="grid min-w-0 gap-4">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
