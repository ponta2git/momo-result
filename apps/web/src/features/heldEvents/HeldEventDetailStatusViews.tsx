import type { Ref } from "react";

import { HeldEventDetailHeaderActions } from "@/features/heldEvents/HeldEventDetailHeaderActions";
import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { ResourcePageState } from "@/shared/ui/feedback/ResourcePageState";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function HeldEventDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="開催詳細を読み込み中" width="wide">
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
        eyebrow="開催記録"
        title="開催の記録を読み込み中"
      />
      <PageContentSurface
        aria-label="開催内容"
        className="grid grid-cols-[minmax(0,1fr)] gap-8"
        role="region"
      >
        <div className="grid gap-4">
          <Skeleton className="h-6 w-32" />
          <div aria-hidden="true" className={inlineActionGroupClass}>
            <Skeleton className="h-11 w-36 rounded-sm pointer-fine:h-10" />
            <Skeleton className="h-11 w-24 rounded-sm pointer-fine:h-10" />
          </div>
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
                <ContentWithActions actions={<Skeleton className="h-11 w-24" />}>
                  <div className="grid gap-1">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-full max-w-72" />
                  </div>
                </ContentWithActions>
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
      <div aria-hidden="true" className="grid min-w-0 grid-cols-2 gap-3">
        <Skeleton className="h-20 w-full rounded-sm" />
        <Skeleton className="h-20 w-full rounded-sm" />
      </div>
    </PageFrame>
  );
}

export function HeldEventDetailUnavailable({
  backHref = "/held-events",
  backLabel = "開催履歴へ戻る",
  backNotice,
  exportHref,
  notFound = false,
  onRetry,
  retrying = false,
  titleRef,
}: {
  backHref?: string;
  backLabel?: string;
  backNotice?: string | undefined;
  exportHref: string;
  notFound?: boolean;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
  titleRef?: Ref<HTMLHeadingElement> | undefined;
}) {
  const headerActions = (
    <HeldEventDetailHeaderActions
      exportHref={exportHref}
      showHistoryLink={backHref !== "/held-events"}
    />
  );
  const headerDescription = `試合数・下書き数は未取得です。${backNotice ?? ""}`;
  return notFound ? (
    <ResourcePageState
      backHref={backHref}
      backLabel={backLabel}
      description="指定された開催は削除されたか、存在しません。開催履歴から別の開催を選んでください。"
      eyebrow="開催記録"
      headerActions={headerActions}
      headerDescription={headerDescription}
      kind="not-found"
      title="開催が見つかりません"
      titleRef={titleRef}
    />
  ) : onRetry ? (
    <ResourcePageState
      backHref={backHref}
      backLabel={backLabel}
      description="通信状態を確認して、もう一度お試しください。"
      eyebrow="開催記録"
      headerActions={headerActions}
      headerDescription={headerDescription}
      kind="error"
      retryLabel="開催詳細を再読み込み"
      retrying={retrying}
      title="開催詳細を読み込めませんでした"
      titleRef={titleRef}
      onRetry={onRetry}
    />
  ) : null;
}
