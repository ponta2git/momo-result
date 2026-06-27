import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

import {
  DrilldownPlayerSelector,
  DrilldownStickyCell,
  DrilldownTableCell,
  DrilldownTableHeader,
  DrilldownTableScroll,
  formatLowerIsBetterDelta,
  LowerIsBetterDeltaBadge,
} from "@/features/seriesComparison/SeriesComparisonDrilldownPrimitives";
import { formatDecimal, isNumber } from "@/features/seriesComparison/seriesComparisonPresentation";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { seriesComparisonKeys } from "@/shared/api/queryKeys";
import { getSeriesComparisonDrilldown } from "@/shared/api/seriesComparison";
import type {
  SeriesComparisonDrilldownQuery,
  SeriesComparisonDrilldownResponse,
  SeriesComparisonResponse,
} from "@/shared/api/seriesComparison";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

type DrilldownView = "events" | "matches";
type RankAverageHistoryPayload = NonNullable<
  SeriesComparisonDrilldownResponse["rankAverageHistory"]
>;
type MatchRow = NonNullable<RankAverageHistoryPayload["matchRows"]>[number];
type EventRow = NonNullable<RankAverageHistoryPayload["heldEventRows"]>[number];

export function RankAverageHistoryDrilldownDialog({
  onMemberChange,
  onOpenChange,
  open,
  response,
  selectedMemberId,
}: {
  onMemberChange: (memberId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  response: SeriesComparisonResponse;
  selectedMemberId: string | null;
}) {
  const [view, setView] = useState<DrilldownView>("events");
  const players = response.players ?? [];
  const selectedPlayer =
    players.find((player) => player.memberId === selectedMemberId) ?? players[0] ?? null;
  const query = useMemo<SeriesComparisonDrilldownQuery | undefined>(() => {
    if (!selectedPlayer) {
      return undefined;
    }
    return {
      gameTitleId: response.scope.gameTitleId,
      mapMasterId: response.scope.mapMasterId,
      memberId: selectedPlayer.memberId,
      metricId: "rank.averageHistory",
      seasonMasterId: response.scope.seasonMasterId,
    };
  }, [
    response.scope.gameTitleId,
    response.scope.mapMasterId,
    response.scope.seasonMasterId,
    selectedPlayer,
  ]);

  const drilldownQuery = useQuery({
    enabled: open && query !== undefined,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      if (!query) {
        throw new Error("series comparison drilldown query is not ready");
      }
      return getSeriesComparisonDrilldown(query, { signal });
    },
    queryKey: seriesComparisonKeys.drilldown(query),
  });
  const data = drilldownQuery.data;
  const payload = data?.rankAverageHistory;
  const loading = open && isInitialQueryLoading(drilldownQuery);
  const showError = shouldShowBlockingQueryError(drilldownQuery);
  const title = selectedPlayer ? `順位の地力: ${selectedPlayer.displayName}` : "順位の地力";

  return (
    <Dialog
      className="flex h-full min-h-0 flex-col"
      description="選択範囲内の対戦順で、順位と平均順位がどう動いたかを確認します。"
      open={open}
      popupClassName="max-w-[min(92rem,calc(100vw-1rem))] items-stretch p-2 sm:p-4"
      surfaceClassName="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] !overflow-hidden p-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:p-5"
      title={title}
      onOpenChange={onOpenChange}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <DrilldownPlayerSelector
            players={players}
            selectedMemberId={selectedPlayer?.memberId}
            onMemberChange={onMemberChange}
          />
          <SegmentedControl
            label="履歴表示"
            options={[
              { label: "開催ごと", value: "events" },
              { label: "試合ごと", value: "matches" },
            ]}
            value={view}
            onValueChange={(next) => setView(next as DrilldownView)}
          />
        </div>
        {loading ? (
          <div className="flex min-h-48 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-sm font-medium text-[var(--color-text-secondary)]">
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 size-4 animate-spin motion-reduce:animate-none"
            />
            履歴を読み込み中
          </div>
        ) : showError ? (
          <Notice title="履歴を表示できません" tone="danger">
            順位履歴の取得に失敗しました。時間をおいて再読み込みしてください。
          </Notice>
        ) : data ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
            {payload ? (
              <>
                <RankHistorySummary data={payload} />
                {view === "events" ? (
                  <HeldEventHistoryTable rows={payload.heldEventRows ?? []} />
                ) : (
                  <MatchHistoryTable rows={payload.matchRows ?? []} />
                )}
              </>
            ) : (
              <Notice title="履歴を表示できません" tone="danger">
                順位履歴の形式が想定と異なります。再読み込みしてください。
              </Notice>
            )}
          </div>
        ) : (
          <EmptyState
            title="履歴がありません"
            description="プレーヤーを選択すると履歴を取得します。"
          />
        )}
      </div>
    </Dialog>
  );
}

function RankHistorySummary({ data }: { data: RankAverageHistoryPayload }) {
  const summary = data.summary;
  const facts = [
    { label: "対象戦数", value: `${summary.targetCount}戦` },
    { label: "現在の平均順位", value: formatDecimal(summary.currentAverageRank) },
    {
      label: "直近開催の平均変化",
      value: formatRankAverageDelta(summary.latestHeldEventAverageRankDelta),
    },
  ];
  return (
    <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-3">
      {facts.map((fact) => (
        <div
          className="min-w-0 rounded-[var(--radius-xs)] bg-[var(--color-surface)] px-2.5 py-2"
          key={fact.label}
        >
          <p className="text-[11px] leading-4 text-[var(--color-text-secondary)]">{fact.label}</p>
          <p className="mt-0.5 text-sm font-semibold break-words text-[var(--color-text-primary)] tabular-nums">
            {fact.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function HeldEventHistoryTable({ rows }: { rows: EventRow[] }) {
  const sortedRows = useMemo(() => rows.toSorted(compareEventRowDesc), [rows]);
  if (rows.length === 0) {
    return <EmptyState title="開催ごとの履歴がありません" description="対象試合がありません。" />;
  }
  return (
    <DrilldownTableScroll ariaLabel="開催ごとの順位履歴">
      <table className="w-full min-w-[62rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <DrilldownTableHeader className="sticky left-0 z-[calc(var(--z-sticky)+1)]">
              開催
            </DrilldownTableHeader>
            <DrilldownTableHeader align="right">試合数</DrilldownTableHeader>
            <DrilldownTableHeader>順位列</DrilldownTableHeader>
            <DrilldownTableHeader align="right">開催平均</DrilldownTableHeader>
            <DrilldownTableHeader>開催内変動</DrilldownTableHeader>
            <DrilldownTableHeader align="right">開催前平均</DrilldownTableHeader>
            <DrilldownTableHeader align="right">開催後平均</DrilldownTableHeader>
            <DrilldownTableHeader>開催による変動</DrilldownTableHeader>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.heldEventId}>
              <DrilldownStickyCell>
                <span className="block font-semibold">{formatDate(row.firstPlayedAt)}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">
                  {shortId(row.heldEventId)}
                </span>
              </DrilldownStickyCell>
              <DrilldownTableCell align="right">{row.matchCount}戦</DrilldownTableCell>
              <DrilldownTableCell>
                {(row.ranks ?? []).map((rank) => `${rank}位`).join(" → ")}
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.eventAverageRank)}
              </DrilldownTableCell>
              <DrilldownTableCell>
                <RankAverageDeltaBadge value={row.eventRankDelta} valueKind="rank" />
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.cumulativeAverageBefore)}
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.cumulativeAverageAfter)}
              </DrilldownTableCell>
              <DrilldownTableCell>
                <RankAverageDeltaBadge value={row.cumulativeAverageDelta} valueKind="decimal" />
              </DrilldownTableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </DrilldownTableScroll>
  );
}

function MatchHistoryTable({ rows }: { rows: MatchRow[] }) {
  const sortedRows = useMemo(() => rows.toSorted(compareMatchRowDesc), [rows]);
  if (rows.length === 0) {
    return <EmptyState title="試合ごとの履歴がありません" description="対象試合がありません。" />;
  }
  return (
    <DrilldownTableScroll ariaLabel="試合ごとの順位履歴">
      <table className="w-full min-w-[64rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <DrilldownTableHeader className="sticky left-0 z-[calc(var(--z-sticky)+1)]">
              対戦順
            </DrilldownTableHeader>
            <DrilldownTableHeader>開催</DrilldownTableHeader>
            <DrilldownTableHeader align="right">第n試合</DrilldownTableHeader>
            <DrilldownTableHeader align="right">順位</DrilldownTableHeader>
            <DrilldownTableHeader align="right">前戦順位</DrilldownTableHeader>
            <DrilldownTableHeader>順位変動</DrilldownTableHeader>
            <DrilldownTableHeader align="right">試合後平均順位</DrilldownTableHeader>
            <DrilldownTableHeader>平均順位変動</DrilldownTableHeader>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.matchId}>
              <DrilldownStickyCell>
                <span className="font-semibold tabular-nums">{row.matchIndex}戦目</span>
              </DrilldownStickyCell>
              <DrilldownTableCell>
                <span className="block">{formatDate(row.playedAt)}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">
                  {shortId(row.heldEventId)}
                </span>
              </DrilldownTableCell>
              <DrilldownTableCell align="right">第{row.matchNoInEvent}試合</DrilldownTableCell>
              <DrilldownTableCell align="right">{row.rank}位</DrilldownTableCell>
              <DrilldownTableCell align="right">
                {isNumber(row.previousRank) ? `${row.previousRank}位` : "初戦"}
              </DrilldownTableCell>
              <DrilldownTableCell>
                <RankAverageDeltaBadge value={row.rankDelta} valueKind="rank" />
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.cumulativeAverageRank)}
              </DrilldownTableCell>
              <DrilldownTableCell>
                <RankAverageDeltaBadge value={row.cumulativeAverageRankDelta} valueKind="decimal" />
              </DrilldownTableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </DrilldownTableScroll>
  );
}

function RankAverageDeltaBadge({
  value,
  valueKind,
}: {
  value: number | null | undefined;
  valueKind: "decimal" | "rank";
}) {
  return (
    <LowerIsBetterDeltaBadge
      labels={rankAverageDeltaLabels}
      nullLabel="初戦"
      value={value}
      valueKind={valueKind}
    />
  );
}

function formatRankAverageDelta(value: number | null | undefined): string {
  return formatLowerIsBetterDelta(value, "decimal", rankAverageDeltaLabels, "対象なし");
}

const rankAverageDeltaLabels = {
  negative: "改善",
  positive: "後退",
  zero: "維持",
} as const;

function compareEventRowDesc(left: EventRow, right: EventRow): number {
  return (
    compareTimestampDesc(left.firstPlayedAt, right.firstPlayedAt) ||
    right.heldEventId.localeCompare(left.heldEventId)
  );
}

function compareMatchRowDesc(left: MatchRow, right: MatchRow): number {
  return (
    compareTimestampDesc(left.playedAt, right.playedAt) ||
    right.matchNoInEvent - left.matchNoInEvent ||
    right.matchIndex - left.matchIndex ||
    right.heldEventId.localeCompare(left.heldEventId) ||
    right.matchId.localeCompare(left.matchId)
  );
}

function compareTimestampDesc(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return right.localeCompare(left);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ja-JP", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}
