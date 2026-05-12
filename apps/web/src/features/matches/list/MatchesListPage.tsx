import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, PenSquare, RefreshCw, ScanLine } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { MatchesListFilters } from "@/features/matches/list/MatchesListFilters";
import { MatchesTable } from "@/features/matches/list/MatchesTable";
import { MatchesWorkQueueSummary } from "@/features/matches/list/MatchesWorkQueueSummary";
import { fetchMatchList, fetchMatchListSummary } from "@/features/matches/list/matchListQuery";
import {
  buildMatchListSearchParams,
  hasMatchListFilters,
  parseMatchListSearchParams,
} from "@/features/matches/list/matchListSearchParams";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";
import {
  sortMatchListItems,
  summarizeMatchList,
  toMatchListItemViews,
} from "@/features/matches/list/matchListViewModel";
import { MatchMobileCard } from "@/features/matches/list/MatchMobileCard";
import { listHeldEvents } from "@/shared/api/heldEvents";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { heldEventKeys, masterKeys, matchKeys } from "@/shared/api/queryKeys";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const rawSearchSignature = searchParams.toString();
  const search = useMemo(
    () => parseMatchListSearchParams(new URLSearchParams(rawSearchSignature)),
    [rawSearchSignature],
  );
  const deferredSearch = useDeferredValue(search);
  const [isFilterPending, startFilterTransition] = useTransition();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const applySearch = (nextSearch: MatchListSearch) => {
    startFilterTransition(() => {
      setSearchParams(buildMatchListSearchParams(nextSearch));
    });
  };
  const clearSearch = () => {
    startFilterTransition(() => {
      setSearchParams(new URLSearchParams());
    });
  };

  const heldEventsQuery = useQuery({
    queryFn: () => listHeldEvents("", 100),
    queryKey: heldEventKeys.scope("matches-list"),
  });
  const gameTitlesQuery = useQuery({
    queryFn: () => listGameTitles(),
    queryKey: masterKeys.gameTitles.list("matches-list"),
  });
  const seasonsQuery = useQuery({
    queryFn: () => listSeasonMasters(),
    queryKey: masterKeys.seasonMasters.list("matches-list"),
  });
  const mapsQuery = useQuery({
    queryFn: () => listMapMasters(),
    queryKey: masterKeys.mapMasters.list("matches-list"),
  });
  const matchesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchMatchList(deferredSearch),
    queryKey: matchKeys.list(deferredSearch),
  });
  const matchesSummaryQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchMatchListSummary(deferredSearch),
    queryKey: matchKeys.summary({
      gameTitleId: deferredSearch.gameTitleId,
      heldEventId: deferredSearch.heldEventId,
      seasonMasterId: deferredSearch.seasonMasterId,
    }),
  });

  const lookupMaps = useMemo(() => {
    return {
      gameTitlesById: new Map((gameTitlesQuery.data?.items ?? []).map((item) => [item.id, item])),
      heldEventsById: new Map((heldEventsQuery.data?.items ?? []).map((item) => [item.id, item])),
      mapsById: new Map((mapsQuery.data?.items ?? []).map((item) => [item.id, item])),
      seasonsById: new Map((seasonsQuery.data?.items ?? []).map((item) => [item.id, item])),
    };
  }, [gameTitlesQuery.data, heldEventsQuery.data, mapsQuery.data, seasonsQuery.data]);

  const items = useMemo(() => {
    const views = toMatchListItemViews(matchesQuery.data?.items ?? [], lookupMaps);
    return sortMatchListItems(views, deferredSearch.sort);
  }, [lookupMaps, matchesQuery.data, deferredSearch.sort]);

  const summaryCounts = useMemo(() => {
    const views = toMatchListItemViews(matchesSummaryQuery.data?.items ?? [], lookupMaps);
    return summarizeMatchList(views);
  }, [lookupMaps, matchesSummaryQuery.data]);
  const matchesDataUpdatedAt = matchesQuery.dataUpdatedAt;
  const summaryDataUpdatedAt = matchesSummaryQuery.dataUpdatedAt;
  const summaryIsFetching = matchesSummaryQuery.isFetching;
  const refetchSummary = matchesSummaryQuery.refetch;

  useEffect(() => {
    if (
      matchesDataUpdatedAt === 0 ||
      summaryIsFetching ||
      matchesDataUpdatedAt <= summaryDataUpdatedAt
    ) {
      return;
    }
    void refetchSummary();
  }, [matchesDataUpdatedAt, refetchSummary, summaryDataUpdatedAt, summaryIsFetching]);

  const hasFilters = hasMatchListFilters(search);
  const showMatchesLoading = isInitialQueryLoading(matchesQuery);
  const showMatchesError = shouldShowBlockingQueryError(matchesQuery);
  const masterLoadFailed =
    shouldShowBlockingQueryError(heldEventsQuery) ||
    shouldShowBlockingQueryError(gameTitlesQuery) ||
    shouldShowBlockingQueryError(seasonsQuery) ||
    shouldShowBlockingQueryError(mapsQuery);
  const searchSignature = useMemo(() => buildMatchListSearchParams(search).toString(), [search]);
  const deferredSearchSignature = useMemo(
    () => buildMatchListSearchParams(deferredSearch).toString(),
    [deferredSearch],
  );
  const isStale = isFilterPending || searchSignature !== deferredSearchSignature;

  const handleManualRefresh = async () => {
    setIsManualRefreshing(true);
    try {
      await Promise.all([matchesQuery.refetch(), matchesSummaryQuery.refetch()]);
    } finally {
      setIsManualRefreshing(false);
    }
  };

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
            onClick={handleManualRefresh}
          >
            最新情報に更新
          </Button>
        </div>
      </section>

      <MatchesWorkQueueSummary
        counts={summaryCounts}
        currentStatus={search.status}
        loading={matchesSummaryQuery.isLoading}
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
        gameTitles={gameTitlesQuery.data?.items ?? []}
        heldEvents={heldEventsQuery.data?.items ?? []}
        initialSearch={search}
        onApply={applySearch}
        onClear={clearSearch}
        seasons={seasonsQuery.data?.items ?? []}
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
