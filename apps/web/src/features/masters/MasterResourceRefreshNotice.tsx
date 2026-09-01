import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

type MasterResourceRefreshNoticeProps = {
  onRetry: () => void;
  resourceLabel: string;
  retrying: boolean;
  stale: boolean;
};

/**
 * Keeps a directory's last settled result visible after a refresh failure.
 * Initial-load failures are owned by the route error boundary; this recovery
 * remains secondary because the cached directory is still usable.
 */
export function MasterResourceRefreshNotice({
  onRetry,
  resourceLabel,
  retrying,
  stale,
}: MasterResourceRefreshNoticeProps) {
  if (!stale) {
    return null;
  }

  return (
    <Notice tone="warning" title={`最新の${resourceLabel}を取得できません`}>
      <p>直前に取得した内容を表示しています。</p>
      <div className="mt-3">
        <Button
          pending={retrying}
          pendingLabel="再読み込み中"
          size="sm"
          variant="secondary"
          onClick={onRetry}
        >
          {resourceLabel}を再読み込み
        </Button>
      </div>
    </Notice>
  );
}
