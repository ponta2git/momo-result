import { Link } from "react-router-dom";

import type { MatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

export function MatchWorkspaceBlockedNotice({
  error,
  onRefreshReviewStatus,
  refreshingReviewStatus,
}: {
  error: MatchWorkspaceOperationErrorView | null;
  onRefreshReviewStatus: () => void;
  refreshingReviewStatus: boolean;
}) {
  return (
    <section aria-labelledby="workspace-blocked-heading">
      <h2
        className="text-xl font-semibold text-[var(--color-text-primary)]"
        id="workspace-blocked-heading"
      >
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
        <Link
          className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-action)] hover:underline"
          to="/matches"
        >
          試合一覧へ戻る
        </Link>
      </div>
      {error ? (
        <Notice className="mt-3" title={error.title} tone="danger">
          <p>{error.detail}</p>
          <p className="mt-1">{error.nextStep}</p>
        </Notice>
      ) : null}
    </section>
  );
}
