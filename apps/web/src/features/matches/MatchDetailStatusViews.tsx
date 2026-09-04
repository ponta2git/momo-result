import { matchResultLedgerRowClass } from "@/shared/ui/data/MatchResultLedger";
import { ResourcePageState } from "@/shared/ui/feedback/ResourcePageState";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MatchDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="試合詳細を読み込み中" width="wide">
      <div>
        <Skeleton className="h-11 w-40 max-w-full rounded-sm pointer-fine:h-9" />
      </div>
      <PageHeader
        actions={
          <>
            <Skeleton className="h-11 w-32 rounded-sm pointer-fine:h-10" />
            <Skeleton className="h-11 w-16 rounded-sm pointer-fine:h-10" />
          </>
        }
        title="試合結果を読み込み中"
      />

      <PageContentSurface className="grid gap-8">
        <div className="grid gap-4">
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

        <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)]">
          <div className="p-4">
            <Skeleton className="h-6 w-32" />
            <div className="mt-2">
              <Skeleton className="h-4 w-full max-w-64" />
            </div>
          </div>
          <div
            aria-hidden="true"
            className="grid divide-y divide-[var(--color-border)]"
            data-match-result-loading-list=""
          >
            {["rank-1", "rank-2", "rank-3", "rank-4"].map((id) => (
              <div key={id} className={matchResultLedgerRowClass} data-match-result-loading-row="">
                <div className="flex items-center gap-3 sm:block">
                  <Skeleton className="h-10 w-14 rounded-sm" />
                  <Skeleton className="h-5 w-28 max-w-full sm:hidden" />
                </div>
                <div className="min-w-0">
                  <Skeleton className="h-5 w-28 max-w-full max-sm:hidden" />
                  <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                    <Skeleton className="h-4 w-32 max-w-full" />
                    <Skeleton className="h-4 w-24 max-w-full" />
                    <Skeleton className="h-4 w-28 max-w-full" />
                  </div>
                </div>
                <div className="grid min-w-0 gap-1 sm:justify-items-end">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-7 w-28 max-w-full" />
                </div>
                <div className="col-span-full flex min-w-0 flex-wrap items-center justify-between gap-2 pt-1 sm:col-span-2 sm:col-start-2">
                  <Skeleton className="h-4 w-24 max-w-full" />
                  <Skeleton className="h-4 w-28 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="grid gap-3">
            <Skeleton className="h-10 rounded-sm" />
            <Skeleton className="h-16 rounded-sm" />
            <Skeleton className="h-16 rounded-sm" />
            <Skeleton className="h-16 rounded-sm" />
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
