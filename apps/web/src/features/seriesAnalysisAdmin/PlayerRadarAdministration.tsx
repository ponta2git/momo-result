import { PlayerRadarAdminPanel } from "@/features/seriesAnalysisAdmin/PlayerRadarAdminPanel";
import { usePlayerRadarAdminModel } from "@/features/seriesAnalysisAdmin/usePlayerRadarAdminModel";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

export function PlayerRadarAdministration({
  gameTitleId,
  gameTitleName,
}: {
  gameTitleId: string;
  gameTitleName: string;
}) {
  const page = usePlayerRadarAdminModel(gameTitleId, gameTitleName);
  if (page.model) return <PlayerRadarAdminPanel model={page.model} />;
  if (page.error)
    return (
      <Notice
        tone="danger"
        title="採点基準の状態を読み込めません"
        action={
          <Button
            pending={page.refreshing}
            pendingLabel="再読み込み中"
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
    <div aria-label="採点基準を読み込み中" role="status" className="grid gap-3">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
