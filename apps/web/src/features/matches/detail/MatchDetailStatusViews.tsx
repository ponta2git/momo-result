import type { ReactNode, Ref } from "react";

import { matchIncidentFactsGridClass } from "@/features/matches/detail/matchDetailPresentation";
import { MatchFeaturePlaceholder } from "@/features/matches/detail/MatchFeatureSection";
import {
  matchResultLedgerBreakdownClass,
  matchResultLedgerFlowClass,
  matchResultLedgerGridClass,
  matchResultLedgerRowClass,
} from "@/shared/matches/MatchResultLedger";
import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { ResourcePageState } from "@/shared/ui/feedback/ResourcePageState";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MatchDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="試合詳細を読み込み中" width="analysis">
      <div>
        <Skeleton className="h-11 w-40 max-w-full rounded-sm pointer-fine:h-9" />
      </div>
      <PageHeader
        actions={
          <div aria-hidden="true" className={inlineActionGroupClass}>
            <Skeleton className="h-11 w-36 rounded-sm pointer-fine:h-9" />
            <Skeleton className="h-11 w-36 rounded-sm pointer-fine:h-9" />
          </div>
        }
        title="試合結果を読み込み中"
      />
      <PageContentSurface className="grid gap-6">
        <div className="grid gap-4">
          <div aria-hidden="true">
            <FactList
              ariaLabel="試合の開催条件"
              columns={4}
              items={["held", "game", "season", "map"].map((id) => ({
                id,
                label: <Skeleton as="span" className="block h-4 w-16 max-w-full" />,
                value: <Skeleton as="span" className="block h-5 w-32 max-w-full" />,
              }))}
            />
          </div>
          <MatchFeaturePlaceholder />
        </div>
        <div className="grid gap-2">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="grid min-w-0 flex-[1_1_16rem] gap-1">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-full max-w-96" />
            </div>
            <Skeleton as="span" className="block h-4 w-24 shrink-0" />
          </div>
          <div
            aria-hidden="true"
            className={matchResultLedgerGridClass}
            data-match-result-loading-list=""
          >
            {[1, 2, 3, 4].map((id) => (
              <div
                key={id}
                className={cn(
                  matchResultLedgerRowClass,
                  "rounded-md border border-[var(--color-border)]",
                )}
                data-match-result-loading-row=""
              >
                <div className="flex items-center gap-2">
                  <Skeleton className="h-10 w-14" />
                  <Skeleton className="h-7 w-32" />
                </div>
                <SkeletonFact valueClassName="h-7 w-24" />
                <div className={matchResultLedgerFlowClass}>
                  <div className={matchResultLedgerBreakdownClass}>
                    <SkeletonFact valueClassName="h-5 w-20" />
                    <SkeletonFact valueClassName="h-5 w-10" />
                    <SkeletonFact valueClassName="h-5 w-12" />
                  </div>
                </div>
                <SkeletonFact valueClassName="h-6 w-40 max-w-full" />
                <div className={matchResultLedgerFlowClass}>
                  <div className={matchIncidentFactsGridClass}>
                    {[1, 2, 3, 4, 5, 6].map((key) => (
                      <SkeletonFact key={key} valueClassName="h-5 w-8" />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </PageContentSurface>
      <div aria-hidden="true" className="grid min-w-0 grid-cols-2 gap-3">
        <Skeleton className="h-20 w-full rounded-sm" />
        <Skeleton className="h-20 w-full rounded-sm" />
      </div>
    </PageFrame>
  );
}

function SkeletonFact({ valueClassName }: { valueClassName: string }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <Skeleton className="h-4 w-12 max-w-full" />
      <Skeleton className={valueClassName} />
    </div>
  );
}

export function MatchDetailLoadFailed({
  notFound = false,
  onRetry,
  retrying = false,
  titleRef,
  recovery,
}: {
  titleRef?: Ref<HTMLHeadingElement>;
  recovery?: ReactNode;
  notFound?: boolean;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
}) {
  return notFound ? (
    <ResourcePageState
      backHref="/matches"
      backLabel="試合一覧へ"
      width="analysis"
      titleRef={titleRef}
      headerActions={
        onRetry ? (
          <Button onClick={onRetry} pending={retrying} size="sm" variant="quiet">
            再取得
          </Button>
        ) : undefined
      }
      description="指定された試合は削除されたか、存在しません。試合一覧から別の試合を選んでください。"
      kind="not-found"
      title="試合が見つかりません"
    >
      {recovery}
    </ResourcePageState>
  ) : onRetry ? (
    <ResourcePageState
      backHref="/matches"
      backLabel="試合一覧へ"
      width="analysis"
      titleRef={titleRef}
      description="通信状態を確認して、もう一度お試しください。"
      kind="error"
      retryLabel="試合詳細を再読み込み"
      retrying={retrying}
      title="試合詳細を読み込めませんでした"
      onRetry={onRetry}
    >
      {recovery}
    </ResourcePageState>
  ) : null;
}
