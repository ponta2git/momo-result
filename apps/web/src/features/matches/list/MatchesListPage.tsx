import {
  AlertTriangle,
  Download,
  LoaderCircle,
  PenSquare,
  RefreshCw,
  ScanLine,
} from "lucide-react";

import { MatchesListFilters } from "@/features/matches/list/MatchesListFilters";
import { MatchesTable } from "@/features/matches/list/MatchesTable";
import { MatchesWorkQueueSummary } from "@/features/matches/list/MatchesWorkQueueSummary";
import { MatchMobileCard } from "@/features/matches/list/MatchMobileCard";
import { useMatchesListPageController } from "@/features/matches/list/useMatchesListPageController";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

function ListSkeleton() {
  return (
    <div className="min-h-[24rem]">
      <div className="hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 lg:grid lg:gap-3">
        <Skeleton className="min-h-10" />
        {["s1", "s2", "s3", "s4"].map((id) => (
          <Skeleton key={id} className="min-h-24" />
        ))}
      </div>
      <div className="grid gap-3 lg:hidden">
        {["m1", "m2", "m3"].map((id) => (
          <Skeleton key={id} className="min-h-56 rounded-[var(--radius-md)]" />
        ))}
      </div>
    </div>
  );
}

export function MatchesListPage() {
  const {
    applySearch,
    clearSearch,
    gameTitles,
    hasFilters,
    heldEvents,
    isManualRefreshing,
    isStale,
    items,
    masterLoadFailed,
    refresh,
    search,
    seasons,
    showMatchesError,
    showMatchesLoading,
    showStaleSkeleton,
    summaryCounts,
    summaryLoading,
  } = useMatchesListPageController();

  return (
    <PageFrame className="gap-5">
      <PageHeader
        description="OCR中、確認待ち、確定済みの記録を一覧します。開催や作品で絞り込めます。"
        eyebrow="試合記録"
        title="試合一覧"
      />

      <section className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <LinkButton
            className="col-span-2 w-full sm:col-span-1 sm:w-auto"
            icon={<ScanLine className="size-4" />}
            to="/ocr/new"
          >
            OCR取り込み
          </LinkButton>
          <LinkButton
            className="w-full sm:w-auto"
            icon={<PenSquare className="size-4" />}
            to="/matches/new"
            variant="secondary"
          >
            手入力で作成
          </LinkButton>
          <LinkButton
            className="w-full sm:w-auto"
            icon={<Download className="size-4" />}
            to="/exports"
            variant="secondary"
          >
            CSV/TSV出力
          </LinkButton>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
          {isStale ? (
            <span className="momo-enter inline-flex items-center gap-2 rounded-full bg-[var(--color-action)]/10 px-3 py-1 text-sm font-medium text-[var(--color-text-secondary)]">
              <LoaderCircle
                aria-hidden="true"
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
              条件を反映中
            </span>
          ) : null}
          <Button
            className="w-44"
            icon={<RefreshCw className="size-4" />}
            pending={isManualRefreshing}
            pendingLabel="更新中…"
            variant="quiet"
            onClick={refresh}
          >
            最新情報に更新
          </Button>
        </div>
      </section>

      {masterLoadFailed ? (
        <Notice tone="warning" title="絞り込み候補の一部を読み込めませんでした。">
          試合一覧は表示できます。開催、作品、シーズンの候補は再読み込み後に選択してください。
        </Notice>
      ) : null}

      <MatchesListFilters
        gameTitles={gameTitles}
        heldEvents={heldEvents}
        initialSearch={search}
        pending={isStale}
        onApply={applySearch}
        onClear={clearSearch}
        seasons={seasons}
      />

      <MatchesWorkQueueSummary
        counts={summaryCounts}
        currentStatus={search.status}
        disabled={isStale}
        loading={summaryLoading}
        onSelectStatus={(status) => {
          applySearch({ ...search, status });
        }}
      />

      <section aria-busy={isStale} className="relative grid min-h-[24rem] gap-4">
        {isStale && !showMatchesLoading && !showStaleSkeleton ? (
          <div className="momo-enter pointer-events-none absolute inset-x-0 top-0 z-[var(--z-base)] flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-b-[var(--radius-sm)] border-x border-b border-[var(--color-action)]/25 bg-[var(--color-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm">
              <LoaderCircle
                aria-hidden="true"
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
              一覧を更新中
            </span>
          </div>
        ) : null}
        {showMatchesLoading || showStaleSkeleton ? (
          <ListSkeleton />
        ) : showMatchesError ? (
          <Notice tone="danger" title="試合一覧を読み込めませんでした。">
            しばらくしてから再読み込みしてください。
          </Notice>
        ) : items.length === 0 ? (
          <EmptyState
            action={
              hasFilters ? (
                <Button onClick={clearSearch} variant="secondary">
                  条件をクリア
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <LinkButton to="/ocr/new">OCR取り込み</LinkButton>
                  <LinkButton to="/matches/new" variant="secondary">
                    手入力で作成
                  </LinkButton>
                </div>
              )
            }
            className="min-h-[18rem]"
            description={
              hasFilters
                ? "状態や開催条件を広げると、他の試合記録も表示できます。"
                : "まずはOCR取り込みか手入力で、最初の試合を登録します。"
            }
            icon={<AlertTriangle className="size-5" />}
            title={hasFilters ? "条件に合う試合がありません" : "まだ試合がありません"}
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <MatchesTable
                actionsDisabled={isStale}
                items={items}
                onSortChange={(sort) => applySearch({ ...search, sort })}
                sort={search.sort}
              />
            </div>
            <div className="grid gap-3 lg:hidden">
              {items.map((item) => (
                <MatchMobileCard key={item.id} actionsDisabled={isStale} item={item} />
              ))}
            </div>
          </>
        )}
      </section>
    </PageFrame>
  );
}
