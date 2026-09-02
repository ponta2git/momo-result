import { Link } from "react-router-dom";

import type { MatchWorkspaceBlockedReviewModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

export function MatchWorkspaceBlockedNotice({
  model,
}: {
  model: MatchWorkspaceBlockedReviewModel;
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
          disabled={model.refresh.pending}
          pending={model.refresh.pending}
          pendingLabel="更新中…"
          variant="secondary"
          onClick={() => void model.refresh.onRefresh()}
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
      {model.feedback.error ? (
        <div className="mt-3">
          <Notice title={model.feedback.error.title} tone="danger">
            <p>{model.feedback.error.detail}</p>
            <p className="mt-1">{model.feedback.error.nextStep}</p>
          </Notice>
        </div>
      ) : null}
    </section>
  );
}
