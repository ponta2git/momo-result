import { ResourcePageState } from "@/shared/ui/feedback/ResourcePageState";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader, responsivePageHeaderActionGroupClass } from "@/shared/ui/layout/PageHeader";

export function HeldEventDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="開催詳細を読み込み中" width="wide">
      <div>
        <Skeleton className="h-11 w-full max-w-40 rounded-sm pointer-fine:h-9" />
      </div>
      <PageHeader
        actions={
          <div className={responsivePageHeaderActionGroupClass}>
            <Skeleton className="h-11 w-full rounded-sm sm:w-36 pointer-fine:h-9" />
            <Skeleton className="h-11 w-full rounded-sm sm:w-28 pointer-fine:h-9" />
            <Skeleton className="h-11 w-full rounded-sm sm:w-20 pointer-fine:h-9" />
          </div>
        }
        description={<Skeleton as="span" className="block h-6 w-full max-w-56" />}
        eyebrow="開催記録"
        title="開催の記録を読み込み中"
      />
      <PageContentSurface className="grid grid-cols-[minmax(0,1fr)] gap-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {["matches", "drafts", "next"].map((id) => (
            <div key={id} className="grid gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
        <div className="grid gap-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-11 w-full max-w-56" />
        </div>
        <section className="grid gap-4">
          <div>
            <Skeleton className="h-6 w-32" />
            <div className="mt-2">
              <Skeleton className="h-4 w-full max-w-64" />
            </div>
          </div>
          <div className="grid gap-4">
            {["match-1", "match-2"].map((id) => (
              <div key={id} className="grid gap-3">
                <div className="flex justify-between gap-4">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-9 w-24" />
                </div>
                <Skeleton className="h-4 w-full max-w-72" />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
      description="指定された開催は削除されたか、存在しません。開催履歴から別の開催を選んでください。"
      eyebrow="開催記録"
      kind="not-found"
      title="開催が見つかりません"
    />
  ) : onRetry ? (
    <ResourcePageState
      backHref={backHref}
      backLabel="開催履歴へ戻る"
      description="通信状態を確認して、もう一度お試しください。"
      eyebrow="開催記録"
      kind="error"
      retryLabel="開催詳細を再読み込み"
      retrying={retrying}
      title="開催詳細を読み込めませんでした"
      onRetry={onRetry}
    />
  ) : null;
}
