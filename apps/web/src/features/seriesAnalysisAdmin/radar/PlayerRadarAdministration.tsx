import { PlayerRadarAdminPanel } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarAdminPanel";
import { PlayerRadarLoading } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarLoading";
import { usePlayerRadarAdministration } from "@/features/seriesAnalysisAdmin/radar/usePlayerRadarAdministration";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

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
  const administration = usePlayerRadarAdministration(gameTitleId, gameTitleName, onApplyAccepted);
  if (administration.view)
    return (
      <PlayerRadarAdminPanel
        administration={administration.view}
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
  return <PlayerRadarLoading label="採点基準を読み込み中" />;
}
