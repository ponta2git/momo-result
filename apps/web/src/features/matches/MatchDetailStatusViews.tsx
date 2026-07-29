import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { Card } from "@/shared/ui/layout/Card";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MatchDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="試合詳細を読み込み中" className="gap-5" width="wide">
      <PageHeader eyebrow="試合記録" title="試合結果を読み込み中" />

      <Card className="grid gap-3 bg-[var(--color-surface-subtle)]">
        <div className="flex flex-wrap gap-4">
          {["held", "game", "season", "map"].map((id) => (
            <div key={id} className="grid gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-32" />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-7 w-28 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-[var(--color-border)] p-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <div className="grid">
          {["rank-1", "rank-2", "rank-3", "rank-4"].map((id) => (
            <div
              key={id}
              className="grid grid-cols-[4rem_minmax(0,1fr)_auto] gap-3 border-b border-[var(--color-border)] p-3 last:border-b-0"
            >
              <Skeleton className="h-10 w-14 rounded-[var(--radius-sm)]" />
              <div className="grid gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
              <Skeleton className="h-7 w-28" />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-3 grid gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="grid gap-3">
          <Skeleton className="h-10 rounded-[var(--radius-sm)]" />
          <Skeleton className="h-16 rounded-[var(--radius-sm)]" />
          <Skeleton className="h-16 rounded-[var(--radius-sm)]" />
          <Skeleton className="h-16 rounded-[var(--radius-sm)]" />
        </div>
      </Card>
    </PageFrame>
  );
}

export function MatchDetailLoadFailed() {
  return (
    <PageFrame className="gap-4" width="wide">
      <Notice tone="danger" title="試合詳細を読み込めませんでした">
        一覧に戻って、対象の試合を選び直してください。
      </Notice>
      <LinkButton to="/matches" variant="secondary">
        試合一覧へ戻る
      </LinkButton>
    </PageFrame>
  );
}
