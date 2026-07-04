import { Link } from "react-router-dom";

import { Button } from "@/shared/ui/actions/Button";
import { Card } from "@/shared/ui/layout/Card";

export function MatchWorkspaceBlockedNotice({
  onRefreshReviewStatus,
  refreshingReviewStatus,
}: {
  onRefreshReviewStatus: () => void;
  refreshingReviewStatus: boolean;
}) {
  return (
    <Card className="mt-5">
      <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
        読み取り中は編集できません
      </h2>
      <p className="mt-2 text-sm text-pretty text-[var(--color-text-secondary)]">
        読み取りが終わるまで結果確認は開けません。完了後、試合一覧の「確認待ち」から開きます。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          disabled={refreshingReviewStatus}
          pending={refreshingReviewStatus}
          pendingLabel="更新中…"
          variant="secondary"
          onClick={onRefreshReviewStatus}
        >
          状態を再確認
        </Button>
        <Link className="text-sm font-semibold text-[var(--color-action)] hover:underline" to="/matches">
          試合一覧へ戻る
        </Link>
      </div>
    </Card>
  );
}
