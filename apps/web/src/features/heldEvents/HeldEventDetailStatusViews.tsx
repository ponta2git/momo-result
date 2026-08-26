import { ResourcePageState } from "@/shared/ui/feedback/ResourcePageState";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function HeldEventDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="開催詳細を読み込み中" width="wide">
      <PageHeader eyebrow="開催記録" title="開催の記録を読み込み中" />
      <PageContentSurface className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {["matches", "drafts", "next"].map((id) => (
            <div key={id} className="grid gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
        <div className="grid gap-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-11 w-56 max-w-full" />
        </div>
        <section className="grid gap-3">
          <div>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="mt-2 h-4 w-64 max-w-full" />
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {["match-1", "match-2"].map((id) => (
              <div key={id} className="grid gap-3 py-4">
                <div className="flex justify-between gap-4">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-9 w-24" />
                </div>
                <Skeleton className="h-4 w-72 max-w-full" />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {["a", "b", "c", "d"].map((player) => (
                    <Skeleton key={player} className="h-16" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </PageContentSurface>
    </PageFrame>
  );
}

export function HeldEventDetailUnavailable({
  backHref = "/held-events",
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
      backLabel="開催履歴へ戻る"
      description="削除されたか、URLが正しくない可能性があります。"
      kind="not-found"
      title="開催履歴が見つかりません"
    />
  ) : onRetry ? (
    <ResourcePageState
      backHref={backHref}
      backLabel="開催履歴へ戻る"
      description="通信状態を確認して、もう一度お試しください。"
      kind="error"
      retryLabel="開催詳細を再読み込み"
      retrying={retrying}
      title="開催詳細を読み込めませんでした"
      onRetry={onRetry}
    />
  ) : null;
}
