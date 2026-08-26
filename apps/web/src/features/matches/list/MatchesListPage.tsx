import { AlertTriangle, ArrowLeft, Download, PenSquare, RefreshCw, ScanLine } from "lucide-react";

import { MatchesFilterBar } from "@/features/matches/list/MatchesFilterBar";
import { MatchesTable } from "@/features/matches/list/MatchesTable";
import { matchListPageSizeOptions } from "@/features/matches/list/matchListSearchParams";
import { MatchMobileCard } from "@/features/matches/list/MatchMobileCard";
import { useMatchesListPageController } from "@/features/matches/list/useMatchesListPageController";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

function ListSkeleton() {
  return (
    <div className="min-h-[24rem]">
      <div className="hidden border-y border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 lg:grid lg:gap-3">
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
    heldEventPicker,
    heldEvents,
    isManualRefreshing,
    items,
    listScopeChanging,
    listUpdating,
    masterLoadFailed,
    matchesRefreshFailed,
    navigation,
    pagination,
    refresh,
    retrySummary,
    search,
    sameScopeRefreshing,
    seasons,
    selectDraftAction,
    showMatchesError,
    showMatchesLoading,
    summaryCounts,
    summaryError,
    summaryLoading,
    summaryMasked,
    updatePage,
    updatePageSize,
  } = useMatchesListPageController();
  const filterActions = { onApply: applySearch, onClear: clearSearch };
  const filterCandidates = { gameTitles, heldEventPicker, heldEvents, seasons };
  const rowActions = {
    checkingDraftIds,
    disabled: listScopeChanging,
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
              variant="secondary"
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

      <PageContentSurface className="grid gap-6">
        {masterLoadFailed ? (
          <Notice tone="warning" title="絞り込み候補を一部読み込めません">
            <p>試合一覧は表示できます。開催、作品、シーズンの候補を再取得できます。</p>
            <div className="mt-3">
              <Button
                pending={isManualRefreshing}
                pendingLabel="再読み込み中"
                size="sm"
                variant="secondary"
                onClick={() => void refresh()}
              >
                候補を再読み込み
              </Button>
            </div>
          </Notice>
        ) : null}

        <MatchesFilterBar
          actions={filterActions}
          candidates={filterCandidates}
          counts={summaryCounts}
          onRetrySummary={retrySummary}
          pending={listScopeChanging}
          search={search}
          summaryError={summaryError}
          summaryLoading={summaryLoading}
          summaryMasked={summaryMasked}
        />

        <section
          aria-busy={listScopeChanging || sameScopeRefreshing || undefined}
          aria-label="登録済みの試合"
          className="relative grid min-h-[24rem] gap-4"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div
              aria-label="試合一覧の操作"
              className="flex flex-wrap items-center justify-end gap-1"
              role="group"
            >
              <LinkButton
                icon={<Download className="size-4" />}
                size="sm"
                to={navigation.exportHref}
                variant="quiet"
              >
                CSV/TSVをまとめて出力
              </LinkButton>
              <IconButton
                aria-label="最新情報に更新"
                disabled={listScopeChanging && !isManualRefreshing}
                icon={<RefreshCw />}
                pending={isManualRefreshing}
                pendingLabel="一覧を更新中"
                tooltip={isManualRefreshing ? "更新中…" : "最新情報に更新"}
                variant="quiet"
                onClick={() => void refresh()}
              />
            </div>
          </div>

          {matchesRefreshFailed ? (
            <Notice
              action={
                <Button
                  pending={isManualRefreshing}
                  pendingLabel="一覧を再読み込み中"
                  size="sm"
                  variant="secondary"
                  onClick={() => void refresh()}
                >
                  一覧を再読み込み
                </Button>
              }
              title="一覧を更新できませんでした"
              tone="warning"
            >
              <p>取得済みの試合は表示したままです。通信状態を確認して再読み込みしてください。</p>
            </Notice>
          ) : null}

          {showMatchesLoading ? (
            <ListSkeleton />
          ) : (
            <StaleShield
              active={listUpdating}
              busyLabel="一覧を更新中"
              contentClassName="grid gap-4"
              fallback={<ListSkeleton />}
              strategy={listScopeChanging ? "preserve-inert" : "preserve-interactive"}
            >
              {showMatchesError ? (
                <Notice tone="danger" title="試合一覧を読み込めません">
                  <p>通信状態を確認して、もう一度お試しください。</p>
                  <div className="mt-3">
                    <Button
                      pending={isManualRefreshing}
                      pendingLabel="再読み込み中"
                      size="sm"
                      onClick={() => void refresh()}
                    >
                      一覧を再読み込み
                    </Button>
                  </div>
                </Notice>
              ) : items.length === 0 ? (
                <EmptyState
                  action={
                    hasFilters ? undefined : (
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
                  placement="embedded"
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
                      disabled={listScopeChanging}
                      pageSizeOptions={[...matchListPageSizeOptions]}
                      pagination={pagination}
                      placement="embedded"
                      onPageChange={updatePage}
                      onPageSizeChange={updatePageSize}
                    />
                  ) : null}
                </>
              )}
            </StaleShield>
          )}
        </section>
      </PageContentSurface>
    </PageFrame>
  );
}
