import {
  AlertTriangle,
  ArrowLeft,
  Download,
  LoaderCircle,
  PenSquare,
  ScanLine,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { MatchesListFilters } from "@/features/matches/list/MatchesListFilters";
import { MatchesStatusRail } from "@/features/matches/list/MatchesStatusRail";
import { MatchesTable } from "@/features/matches/list/MatchesTable";
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
import { momoTransition } from "@/shared/ui/motion/variants";

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
    navigation,
    pagination,
    refresh,
    search,
    seasons,
    selectDraftAction,
    showMatchesError,
    showMatchesLoading,
    summaryCounts,
    summaryLoading,
    summaryMasked,
    updatePage,
    updatePageSize,
  } = useMatchesListPageController();
  const filterActions = { onApply: applySearch, onClear: clearSearch };
  const filterCandidates = { gameTitles, heldEvents, seasons };
  const rowActions = {
    checkingDraftIds,
    disabled: isStale,
    onDraftStatusCheckAction: selectDraftAction,
  };

  return (
    <PageFrame>
      {navigation.backHref ? (
        <div>
          <LinkButton
            icon={<ArrowLeft aria-hidden="true" className="size-4" />}
            size="sm"
            to={navigation.backHref}
            variant="quiet"
          >
            前の画面へ戻る
          </LinkButton>
        </div>
      ) : null}
      <PageHeader
        actions={
          <div
            aria-label="試合を登録"
            className="grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center"
            role="group"
          >
            <LinkButton
              className="w-full sm:w-auto"
              icon={<ScanLine className="size-4" />}
              size="sm"
              to={navigation.ocrHref}
            >
              OCR取り込み
            </LinkButton>
            <LinkButton
              className="w-full sm:w-auto"
              icon={<PenSquare className="size-4" />}
              size="sm"
              to={navigation.manualCreateHref}
              variant="secondary"
            >
              手入力で作成
            </LinkButton>
          </div>
        }
        title="試合一覧"
      />

      {masterLoadFailed ? (
        <Notice tone="warning" title="絞り込み候補を一部読み込めません">
          試合一覧は表示できます。開催、作品、シーズンの候補は再読み込み後に選べます。
        </Notice>
      ) : null}

      <MatchesStatusRail
        counts={summaryCounts}
        currentStatus={search.status}
        disabled={isStale}
        loading={summaryLoading}
        masked={summaryMasked}
        onSelectStatus={(status) => {
          applySearch({ ...search, page: 1, status });
        }}
      />

      <MatchesListFilters
        actions={filterActions}
        candidates={filterCandidates}
        onRefresh={refresh}
        pending={isStale}
        refreshing={isManualRefreshing}
        search={search}
      />

      <section
        aria-busy={isStale || undefined}
        aria-label="登録済みの試合"
        className="relative grid min-h-[24rem] gap-4"
      >
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {pagination ? (
            <p className="text-sm font-medium text-[var(--color-text-secondary)] tabular-nums">
              {pagination.totalItems.toLocaleString()}件
            </p>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
            <AnimatePresence initial={false}>
              {isStale ? (
                <motion.span
                  key="list-pending"
                  animate={{ opacity: 1, y: 0 }}
                  aria-live="polite"
                  className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--color-action)]/10 px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]"
                  exit={{ opacity: 0, y: -2 }}
                  initial={{ opacity: 0, y: 2 }}
                  transition={momoTransition}
                >
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                  />
                  一覧を更新中
                </motion.span>
              ) : null}
            </AnimatePresence>
            <LinkButton
              icon={<Download className="size-4" />}
              size="sm"
              to={navigation.exportHref}
              variant="quiet"
            >
              CSV/TSVをまとめて出力
            </LinkButton>
          </div>
        </div>

        <StaleShield active={showMatchesLoading} fallback={<ListSkeleton />}>
          <motion.div
            animate={{ opacity: isStale ? 0.7 : 1 }}
            className="grid gap-4"
            transition={momoTransition}
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
                      <LinkButton to={navigation.ocrHref}>OCR取り込み</LinkButton>
                      <LinkButton to={navigation.manualCreateHref} variant="secondary">
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
                  <MatchesTable items={items} rowActions={rowActions} />
                </div>
                <div className="grid gap-3 lg:hidden">
                  {items.map((item) => (
                    <MatchMobileCard key={item.id} item={item} rowActions={rowActions} />
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
          </motion.div>
        </StaleShield>
      </section>
    </PageFrame>
  );
}
