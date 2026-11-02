import type { Ref } from "react";

import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { ResourcePageState } from "@/shared/ui/feedback/ResourcePageState";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function HeldEventDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="開催詳細を読み込み中" width="analysis">
      <div>
        <Skeleton className="h-11 w-full max-w-40 rounded-sm pointer-fine:h-9" />
      </div>
      <PageHeader
        actions={
          <div aria-hidden="true" className={inlineActionGroupClass}>
            <Skeleton className="h-11 w-28 rounded-sm pointer-fine:h-9" />
            <Skeleton className="h-11 w-20 rounded-sm pointer-fine:h-9" />
          </div>
        }
        description={<Skeleton as="span" className="block h-5 w-full max-w-56" />}
        title="開催の記録を読み込み中"
      />
      {/* Mirrors the ready surface: the next-match actions and the match timeline, whose
          heading line, marker column, actions, and player grid keep their ready sizes. */}
      <PageContentSurface aria-label="開催内容" className="grid gap-6" role="region">
        <div className="grid gap-8">
          <div className="grid gap-2">
            <Skeleton className="h-5 w-32" />
            <div aria-hidden="true" className={inlineActionGroupClass}>
              <Skeleton className="h-11 w-36 rounded-sm pointer-fine:h-10" />
              <Skeleton className="h-11 w-24 rounded-sm pointer-fine:h-10" />
            </div>
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-5 w-24" />
            <div className="grid gap-12">
              {["match-1", "match-2"].map((id) => (
                <div key={id} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="grid min-w-0 gap-4">
                    <ContentWithActions
                      actions={
                        <div aria-hidden="true" className={inlineActionGroupClass}>
                          <Skeleton className="h-11 w-24 rounded-sm pointer-fine:h-9" />
                          <Skeleton className="h-11 w-24 rounded-sm pointer-fine:h-9" />
                        </div>
                      }
                    >
                      <div className="grid gap-1">
                        <div className="flex min-h-8 items-center">
                          <Skeleton className="h-5 w-20" />
                        </div>
                        <Skeleton className="h-5 w-full max-w-72" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </ContentWithActions>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
                      {["a", "b", "c", "d"].map((player) => (
                        <Skeleton key={player} className="h-10" />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </PageContentSurface>
      <div aria-hidden="true" className="grid min-w-0 grid-cols-2 gap-x-2">
        <Skeleton className="h-18 w-full rounded-sm" />
        <Skeleton className="h-18 w-full rounded-sm" />
      </div>
    </PageFrame>
  );
}

export function HeldEventDetailUnavailable({
  notFound = false,
  onRetry,
  retrying = false,
  titleRef,
}: {
  notFound?: boolean;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
  titleRef?: Ref<HTMLHeadingElement> | undefined;
}) {
  return notFound ? (
    <ResourcePageState
      backHref="/held-events"
      backLabel="開催履歴へ"
      width="analysis"
      description="指定された開催は削除されたか、存在しません。開催履歴から別の開催を選んでください。"
      kind="not-found"
      title="開催が見つかりません"
      titleRef={titleRef}
    />
  ) : onRetry ? (
    <ResourcePageState
      backHref="/held-events"
      backLabel="開催履歴へ"
      width="analysis"
      description="通信状態を確認して、もう一度お試しください。"
      kind="error"
      retryLabel="開催詳細を再読み込み"
      retrying={retrying}
      title="開催詳細を読み込めませんでした"
      titleRef={titleRef}
      onRetry={onRetry}
    />
  ) : null;
}
