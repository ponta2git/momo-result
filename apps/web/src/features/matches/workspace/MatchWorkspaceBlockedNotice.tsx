import { Link } from "react-router-dom";

import type { MatchWorkspaceBlockedReviewView } from "@/features/matches/workspace/matchWorkspacePanelViews";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { contentText } from "@/shared/ui/typography";

export function MatchWorkspaceBlockedNotice({ view }: { view: MatchWorkspaceBlockedReviewView }) {
  return (
    <section aria-labelledby="workspace-blocked-heading" className="grid gap-4">
      <div>
        <h2 className={contentText.primary} id="workspace-blocked-heading">
          読み取り中は編集できません
        </h2>
        <p className={cn(contentText.body, "mt-2 text-pretty")}>
          読み取りが終わるまで結果確認は開けません。完了後、試合一覧の「確認待ち」から開きます。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={view.refresh.pending}
          pending={view.refresh.pending}
          pendingLabel="更新中…"
          variant="secondary"
          onClick={() => void view.refresh.onRefresh()}
        >
          状態を再確認
        </Button>
        <Link
          className="font-plain inline-flex min-h-11 items-center text-sm text-[var(--color-action)] hover:underline"
          to="/matches"
        >
          試合一覧へ戻る
        </Link>
      </div>
      {view.feedback.error ? (
        <div>
          <Notice title={view.feedback.error.title} tone="danger">
            <p>{view.feedback.error.detail}</p>
            <p className="mt-1">{view.feedback.error.nextStep}</p>
          </Notice>
        </div>
      ) : null}
    </section>
  );
}
