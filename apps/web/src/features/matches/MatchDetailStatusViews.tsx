import { ResourcePageState } from "@/shared/ui/feedback/ResourcePageState";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MatchDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="試合詳細を読み込み中" width="wide">
      <PageHeader title="試合結果を読み込み中" />

      <PageContentSurface className="grid gap-8">
        <div className="grid gap-3">
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
        </div>

        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
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
        </div>

        <div>
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
        </div>
      </PageContentSurface>
    </PageFrame>
  );
}

export function MatchDetailLoadFailed({
  backHref = "/matches",
  notFound = false,
  onRetry,
  retrying = false,
}: {
  backHref?: string;
  notFound?: boolean;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
}) {
  return notFound ? (
    <ResourcePageState
      backHref={backHref}
      backLabel="前の画面へ戻る"
      description="指定された試合は削除されたか、存在しません。前の画面から別の試合を選んでください。"
      kind="not-found"
      title="試合が見つかりません"
    />
  ) : onRetry ? (
    <ResourcePageState
      backHref={backHref}
      backLabel="前の画面へ戻る"
      description="通信状態を確認して、もう一度お試しください。"
      kind="error"
      retryLabel="試合詳細を再読み込み"
      retrying={retrying}
      title="試合詳細を読み込めませんでした"
      onRetry={onRetry}
    />
  ) : null;
}
