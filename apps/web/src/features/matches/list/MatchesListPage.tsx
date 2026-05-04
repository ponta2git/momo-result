import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, PenSquare, RefreshCw, ScanLine } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { listHeldEvents } from "@/features/draftReview/api";
import { MatchesListFilters } from "@/features/matches/list/MatchesListFilters";
import { MatchesTable } from "@/features/matches/list/MatchesTable";
import { MatchesWorkQueueSummary } from "@/features/matches/list/MatchesWorkQueueSummary";
import { fetchMatchList, fetchMatchListSummary } from "@/features/matches/list/matchListQuery";
import {
  buildMatchListSearchParams,
  hasMatchListFilters,
  parseMatchListSearchParams,
} from "@/features/matches/list/matchListSearchParams";
import {
  sortMatchListItems,
  summarizeMatchList,
  toMatchListItemViews,
} from "@/features/matches/list/matchListViewModel";
import { MatchMobileCard } from "@/features/matches/list/MatchMobileCard";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
} from "@/shared/api/queryErrorState";
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
  const search = parseMatchListSearchParams(searchParams);

  const heldEventsQuery = useSuspenseQuery({
    queryFn: () => listHeldEvents("", 100),
    queryKey: ["held-events", "matches-list"],
  });
  const gameTitlesQuery = useSuspenseQuery({
    queryFn: () => listGameTitles(),
    queryKey: ["game-titles", "matches-list"],
  });
  const seasonsQuery = useSuspenseQuery({
    queryFn: () => listSeasonMasters(),
    queryKey: ["season-masters", "matches-list"],
  });
  const mapsQuery = useSuspenseQuery({
    queryFn: () => listMapMasters(),
    queryKey: ["map-masters", "matches-list"],
  });
  const matchesQuery = useQuery({
    queryFn: () => fetchMatchList(search),
    queryKey: ["matches", "list", search],
  });
  const matchesSummaryQuery = useQuery({
    queryFn: () => fetchMatchListSummary(search),
    queryKey: [
      "matches",
      "summary",
      {
        gameTitleId: search.gameTitleId,
        heldEventId: search.heldEventId,
        seasonMasterId: search.seasonMasterId,
      },
    ],
  });

  const lookupMaps = useMemo(() => {
    return {
      gameTitlesById: new Map((gameTitlesQuery.data.items ?? []).map((item) => [item.id, item])),
      heldEventsById: new Map((heldEventsQuery.data.items ?? []).map((item) => [item.id, item])),
      mapsById: new Map((mapsQuery.data.items ?? []).map((item) => [item.id, item])),
      seasonsById: new Map((seasonsQuery.data.items ?? []).map((item) => [item.id, item])),
    };
  }, [gameTitlesQuery.data, heldEventsQuery.data, mapsQuery.data, seasonsQuery.data]);

  const items = useMemo(() => {
    const views = toMatchListItemViews(matchesQuery.data?.items ?? [], lookupMaps);
    return sortMatchListItems(views, search.sort);
  }, [lookupMaps, matchesQuery.data, search.sort]);

  const summaryCounts = useMemo(() => {
    const views = toMatchListItemViews(matchesSummaryQuery.data?.items ?? [], lookupMaps);
    return summarizeMatchList(views);
  }, [lookupMaps, matchesSummaryQuery.data]);

  const hasFilters = hasMatchListFilters(search);
  const showMatchesLoading = isInitialQueryLoading(matchesQuery);
  const showMatchesError = shouldShowBlockingQueryError(matchesQuery);
  const refreshing = matchesQuery.isFetching || matchesSummaryQuery.isFetching;

  return (
    <PageFrame className="gap-5">
      <PageHeader
        description="OCR中、確定前、確定済みの試合記録を確認します。"
        title="試合"
        actions={
          <>
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
            <Button
              icon={<RefreshCw className="size-4" />}
              pending={refreshing}
              pendingLabel="更新中..."
              variant="quiet"
              onClick={async () => {
                await Promise.all([matchesQuery.refetch(), matchesSummaryQuery.refetch()]);
              }}
            >
              最新情報に更新
            </Button>
          </>
        }
      />

      <MatchesWorkQueueSummary
        counts={summaryCounts}
        currentStatus={search.status}
        loading={matchesSummaryQuery.isLoading}
        onSelectStatus={(status) => {
          const nextSearch = { ...search, status };
          setSearchParams(buildMatchListSearchParams(nextSearch));
        }}
      />

      <MatchesListFilters
        key={buildMatchListSearchParams(search).toString()}
        gameTitles={gameTitlesQuery.data.items ?? []}
        heldEvents={heldEventsQuery.data.items ?? []}
        initialSearch={search}
        onApply={(nextSearch) => setSearchParams(buildMatchListSearchParams(nextSearch))}
        onClear={() => setSearchParams(new URLSearchParams())}
        seasons={seasonsQuery.data.items ?? []}
      />

      <section className="grid gap-4">
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
                <Button onClick={() => setSearchParams(new URLSearchParams())} variant="secondary">
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
                : "最初の試合登録は OCR 取り込みから始めるか、手入力の作成導線を使ってください。"
            }
            icon={<AlertTriangle className="size-5" />}
            title={hasFilters ? "条件に合う試合がありません" : "まだ試合がありません"}
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <MatchesTable
                items={items}
                onSortChange={(sort) =>
                  setSearchParams(buildMatchListSearchParams({ ...search, sort }))
                }
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
