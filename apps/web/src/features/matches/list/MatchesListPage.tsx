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
import { matchListPageSizeOptions } from "@/features/matches/list/matchListSearchParams";
import { MatchMobileCard } from "@/features/matches/list/MatchMobileCard";
import { useMatchesListPageController } from "@/features/matches/list/useMatchesListPageController";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

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
    checkingDraftIds,
    clearSearch,
    gameTitles,
    hasFilters,
    heldEvents,
    isManualRefreshing,
    isStale,
    items,
    masterLoadFailed,
    pagination,
    refresh,
    search,
    seasons,
    selectDraftAction,
    showMatchesError,
    showMatchesLoading,
    showStaleSkeleton,
    summaryCounts,
    summaryLoading,
    summaryMasked,
    updatePage,
    updatePageSize,
  } = useMatchesListPageController();

  return (
    <PageFrame className="gap-5">
      <PageHeader
        description="OCR中から確定済みまで、試合記録をまとめて管理します。開催や作品で絞り込めます。"
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
        <Notice tone="warning" title="絞り込み候補を一部読み込めません">
          試合一覧は表示できます。開催、作品、シーズンの候補は再読み込み後に選べます。
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
        masked={summaryMasked}
        onSelectStatus={(status) => {
          applySearch({ ...search, page: 1, status });
        }}
      />

      <section aria-busy={isStale || undefined} className="relative grid min-h-[24rem] gap-4">
        <StaleShield
          active={showMatchesLoading || showStaleSkeleton}
          contentClassName="grid gap-4"
          fallback={<ListSkeleton />}
        >
          {showMatchesError ? (
            <Notice tone="danger" title="試合一覧を読み込めません">
              時間をおいて、再読み込みしてください。
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
                  ? "状態や開催条件を広げると、他の試合記録を確認できます。"
                  : "OCR取り込みか手入力で、最初の試合を登録します。"
              }
              icon={<AlertTriangle className="size-5" />}
              title={hasFilters ? "該当する試合はありません" : "試合はまだありません"}
            />
          ) : (
            <>
              <div className="hidden lg:block">
                <MatchesTable
                  actionsDisabled={isStale}
                  checkingDraftIds={checkingDraftIds}
                  items={items}
                  onDraftStatusCheckAction={selectDraftAction}
                  onSortChange={(sort) => applySearch({ ...search, page: 1, sort })}
                  sort={search.sort}
                />
              </div>
              <div className="grid gap-3 lg:hidden">
                {items.map((item) => (
                  <MatchMobileCard
                    key={item.id}
                    actionsDisabled={isStale}
                    checkingDraftIds={checkingDraftIds}
                    item={item}
                    onDraftStatusCheckAction={selectDraftAction}
                  />
                ))}
              </div>
              {pagination ? (
                <PaginationControls
                  disabled={isStale}
                  pageSizeOptions={[...matchListPageSizeOptions]}
                  pagination={pagination}
                  onPageChange={updatePage}
                  onPageSizeChange={updatePageSize}
                />
              ) : null}
            </>
          )}
        </StaleShield>
      </section>
    </PageFrame>
  );
}
