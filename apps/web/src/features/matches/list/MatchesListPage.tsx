import { AlertTriangle, Download, PenSquare, RefreshCw, ScanLine } from "lucide-react";
import { Link } from "react-router-dom";

import { MatchesListFilters } from "@/features/matches/list/MatchesListFilters";
import { MatchesTable } from "@/features/matches/list/MatchesTable";
import { MatchesWorkQueueSummary } from "@/features/matches/list/MatchesWorkQueueSummary";
import { MatchMobileCard } from "@/features/matches/list/MatchMobileCard";
import { useMatchesListPageController } from "@/features/matches/list/useMatchesListPageController";
import { Button } from "@/shared/ui/actions/Button";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

function TableSkeleton() {
  return (
    <div className="grid gap-3">
      <Skeleton className="min-h-10" />
      {["s1", "s2", "s3", "s4", "s5"].map((id) => (
        <Skeleton key={id} className="min-h-18" />
      ))}
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

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/ocr/new">
            <Button icon={<ScanLine className="size-4" />}>OCR取り込み</Button>
          </Link>
          <Link to="/matches/new">
            <Button icon={<PenSquare className="size-4" />} variant="secondary">
              手入力で作成
            </Button>
          </Link>
          <Link to="/exports">
            <Button icon={<Download className="size-4" />} variant="secondary">
              CSV/TSV出力
            </Button>
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isStale ? (
            <span className="text-sm font-medium text-[var(--color-text-secondary)]">
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
        onApply={applySearch}
        onClear={clearSearch}
        seasons={seasons}
      />

      <section
        aria-busy={isStale}
        className={`grid gap-4 transition-opacity duration-150 ${isStale ? "opacity-70" : ""}`}
      >
        {showMatchesLoading ? (
          <TableSkeleton />
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
            description={
              hasFilters
                ? "状態や開催条件を広げると、他の試合記録も表示できます。"
                : "最初の試合は、OCR取り込みまたは手入力で登録してください。"
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
