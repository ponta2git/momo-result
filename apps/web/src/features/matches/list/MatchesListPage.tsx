import {
  AlertTriangle,
  Download,
  LoaderCircle,
  PenSquare,
  RefreshCw,
  ScanLine,
} from "lucide-react";
import { Link } from "react-router-dom";

import { MatchesListFilters } from "@/features/matches/list/MatchesListFilters";
import { MatchesTable } from "@/features/matches/list/MatchesTable";
import { MatchesWorkQueueSummary } from "@/features/matches/list/MatchesWorkQueueSummary";
import { MatchMobileCard } from "@/features/matches/list/MatchMobileCard";
import { useMatchesListPageController } from "@/features/matches/list/useMatchesListPageController";
import { Button } from "@/shared/ui/actions/Button";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { MomoStationIllustration } from "@/shared/ui/feedback/MomoStationIllustration";
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
    summaryCounts,
    summaryLoading,
  } = useMatchesListPageController();

  return (
    <PageFrame className="gap-5">
      <PageHeader
        description="処理中、確認待ち、確定済みの試合記録を確認します。開催や作品で絞り込み、必要な記録をすばやく探せます。"
        eyebrow="試合記録"
        title="試合一覧"
      />

      <section className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Link className="col-span-2 sm:col-span-1" to="/ocr/new">
            <Button className="w-full sm:w-auto" icon={<ScanLine className="size-4" />}>
              OCR取り込み
            </Button>
          </Link>
          <Link to="/matches/new">
            <Button
              className="w-full sm:w-auto"
              icon={<PenSquare className="size-4" />}
              variant="secondary"
            >
              手入力で作成
            </Button>
          </Link>
          <Link to="/exports">
            <Button
              className="w-full sm:w-auto"
              icon={<Download className="size-4" />}
              variant="secondary"
            >
              CSV/TSV出力
            </Button>
          </Link>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
          {isStale ? (
            <span className="momo-enter inline-flex items-center gap-2 rounded-full bg-[var(--color-action)]/10 px-3 py-1 text-sm font-medium text-[var(--color-text-secondary)]">
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
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

      <MatchesWorkQueueSummary
        counts={summaryCounts}
        currentStatus={search.status}
        loading={summaryLoading}
        onSelectStatus={(status) => {
          applySearch({ ...search, status });
        }}
      />

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

      <section aria-busy={isStale} className="relative grid min-h-[24rem] gap-4">
        {isStale && !showMatchesLoading ? (
          <div className="momo-enter pointer-events-none absolute inset-x-0 top-0 z-[var(--z-base)] flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-b-[var(--radius-sm)] border-x border-b border-[var(--color-action)]/25 bg-[var(--color-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm">
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              一覧を更新中
            </span>
          </div>
        ) : null}
        {showMatchesLoading ? (
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
                  <Link to="/ocr/new">
                    <Button>OCR取り込み</Button>
                  </Link>
                  <Link to="/matches/new">
                    <Button variant="secondary">手入力で作成</Button>
                  </Link>
                </div>
              )
            }
            className="min-h-[18rem]"
            description={
              <span className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                <span>
                  {hasFilters
                    ? "状態や開催条件を広げると、他の試合記録も表示できます。"
                    : "最初の試合は、OCR取り込みまたは手入力で登録してください。"}
                </span>
                <MomoStationIllustration
                  className="mx-auto max-w-36 sm:mr-0 sm:ml-auto"
                  tone={hasFilters ? "empty" : "ready"}
                />
              </span>
            }
            icon={<AlertTriangle className="size-5" />}
            title={hasFilters ? "条件に合う試合がありません" : "まだ試合がありません"}
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <MatchesTable
                items={items}
                onSortChange={(sort) => applySearch({ ...search, sort })}
                sort={search.sort}
              />
            </div>
            <div className="grid gap-3 lg:hidden">
              {items.map((item) => (
                <MatchMobileCard key={item.id} item={item} />
              ))}
            </div>
          </>
        )}
      </section>
    </PageFrame>
  );
}
