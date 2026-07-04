import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { Card } from "@/shared/ui/layout/Card";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MatchDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="試合詳細を読み込み中" className="gap-5" width="wide">
      <PageHeader
        description="試合結果、プレーヤー成績、開催情報を取得しています。"
        eyebrow="試合記録"
        title="試合詳細を読み込み中"
      />

      <Card className="overflow-hidden p-0">
        <div className="grid gap-0 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-5 lg:border-r lg:border-b-0">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-3 h-8 w-44" />
            <Skeleton className="mt-4 h-8 w-24 rounded-full" />
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {["game", "season", "map", "owner", "played", "created"].map((id) => (
              <div key={id} className="grid gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-36" />
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Skeleton className="h-48 rounded-[var(--radius-md)]" />
          <div className="grid gap-2">
            {["rank-1", "rank-2", "rank-3", "rank-4"].map((id) => (
              <Skeleton key={id} className="h-12 rounded-[var(--radius-sm)]" />
            ))}
          </div>
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
