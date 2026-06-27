import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import type { Player } from "@/features/seriesComparison/seriesComparisonPresentation";
import {
  formatDecimal,
  formatPercent,
  formatPlayOrderLabel,
  isNumber,
  playOrderColor,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { seriesComparisonKeys } from "@/shared/api/queryKeys";
import { getSeriesComparisonDrilldown } from "@/shared/api/seriesComparison";
import type {
  SeriesComparisonDrilldownQuery,
  SeriesComparisonDrilldownResponse,
  SeriesComparisonResponse,
} from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

type TableView = "breakdown" | "trendData";
type PlayOrderPayload = NonNullable<SeriesComparisonDrilldownResponse["playOrderRankHistory"]>;
type TrendRow = NonNullable<PlayOrderPayload["averageTrendRows"]>[number];
type PlayOrderRow = NonNullable<PlayOrderPayload["playOrderRows"]>[number];

export function PlayOrderRankHistoryDrilldownDialog({
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
  const [tableView, setTableView] = useState<TableView>("trendData");
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
      metricId: "playOrder.rankHistory",
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
        throw new Error("series comparison play order drilldown query is not ready");
      }
      return getSeriesComparisonDrilldown(query, { signal });
    },
    queryKey: seriesComparisonKeys.drilldown(query),
  });
  const data = drilldownQuery.data;
  const payload = data?.playOrderRankHistory;
  const loading = open && isInitialQueryLoading(drilldownQuery);
  const showError = shouldShowBlockingQueryError(drilldownQuery);
  const title = selectedPlayer ? `番手別成績: ${selectedPlayer.displayName}` : "番手別成績";

  return (
    <Dialog
      className="flex h-full min-h-0 flex-col"
      description="番手ごとの平均順位が、試合を重ねてどう動いたかを確認します。"
      open={open}
      popupClassName="max-w-[min(92rem,calc(100vw-1rem))] items-stretch p-2 sm:p-4"
      surfaceClassName="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] !overflow-hidden p-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:p-5"
      title={title}
      onOpenChange={onOpenChange}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)] lg:items-start">
          <PlayerSelector
            players={players}
            selectedMemberId={selectedPlayer?.memberId}
            onMemberChange={onMemberChange}
          />
        </div>
        {loading ? (
          <div className="flex min-h-48 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-sm font-medium text-[var(--color-text-secondary)]">
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 size-4 animate-spin motion-reduce:animate-none"
            />
            番手履歴を読み込み中
          </div>
        ) : showError ? (
          <Notice title="番手履歴を表示できません" tone="danger">
            番手履歴の取得に失敗しました。時間をおいて再読み込みしてください。
          </Notice>
        ) : data ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
            {payload ? (
              <>
                <PlayOrderSummary data={payload} />
                <AverageTrendPanel
                  payload={payload}
                  tableView={tableView}
                  onTableViewChange={setTableView}
                />
              </>
            ) : (
              <Notice title="番手履歴を表示できません" tone="danger">
                番手履歴の形式が想定と異なります。再読み込みしてください。
              </Notice>
            )}
          </div>
        ) : (
          <EmptyState
            title="番手履歴がありません"
            description="プレーヤーを選択すると番手履歴を取得します。"
          />
        )}
      </div>
    </Dialog>
  );
}

function PlayerSelector({
  players,
  selectedMemberId,
  onMemberChange,
}: {
  players: Player[];
  selectedMemberId: string | undefined;
  onMemberChange: (memberId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {players.map((player, index) => {
        const selected = player.memberId === selectedMemberId;
        return (
          <Button
            key={player.memberId}
            className={cn(
              "justify-start border-l-4",
              selected ? "bg-[var(--color-action)]/10" : "",
            )}
            size="sm"
            style={{ borderLeftColor: playerColor(index) }}
            variant={selected ? "secondary" : "quiet"}
            onClick={() => onMemberChange(player.memberId)}
          >
            {player.displayName}
          </Button>
        );
      })}
    </div>
  );
}

function PlayOrderSummary({ data }: { data: PlayOrderPayload }) {
  const summary = data.summary;
  const facts = [
    { label: "対象戦数", value: `${summary.targetCount}戦` },
    { label: "現在の平均順位", value: formatDecimal(summary.currentAverageRank) },
    {
      label: "良かった番手",
      value: formatPlayOrderSummaryValue(summary.bestPlayOrder, summary.bestPlayOrderAverageRank),
    },
    {
      label: "重かった番手",
      value: formatPlayOrderSummaryValue(summary.worstPlayOrder, summary.worstPlayOrderAverageRank),
    },
    { label: "番手差", value: isNumber(summary.spread) ? formatDecimal(summary.spread) : "-" },
    { label: "番手別件数", value: formatCountsByPlayOrder(summary.countsByPlayOrder ?? []) },
  ];
  return (
    <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-3 xl:grid-cols-6">
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

function AverageTrendPanel({
  payload,
  tableView,
  onTableViewChange,
}: {
  payload: PlayOrderPayload;
  tableView: TableView;
  onTableViewChange: (value: TableView) => void;
}) {
  const rows = payload.averageTrendRows ?? [];
  if (rows.length === 0) {
    return <EmptyState title="推移データがありません" description="対象試合がありません。" />;
  }
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(14rem,20rem)_auto_minmax(0,1fr)] gap-3">
      <div className="min-h-0 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            番手別累積平均順位
          </h3>
          <PlayOrderLegend />
        </div>
        <CumulativeRankChart rows={rows} />
      </div>
      <div className="flex justify-end">
        <SegmentedControl
          label="番手履歴の表"
          options={[
            { label: "推移データ", value: "trendData" },
            { label: "番手別集計", value: "breakdown" },
          ]}
          value={tableView}
          onValueChange={(next) => onTableViewChange(next as TableView)}
        />
      </div>
      {tableView === "trendData" ? (
        <PlayOrderTrendTable rows={rows} />
      ) : (
        <PlayOrderBreakdownTable rows={payload.playOrderRows ?? []} />
      )}
    </div>
  );
}

function CumulativeRankChart({ rows }: { rows: TrendRow[] }) {
  const maxMatchIndex = Math.max(1, ...rows.map((row) => row.matchIndex));
  const grouped = [1, 2, 3, 4].map((playOrder) => ({
    playOrder,
    rows: rows.filter((row) => row.playOrder === playOrder),
  }));
  return (
    <RankChartFrame ariaLabel="番手別累積平均順位グラフ" maxMatchIndex={maxMatchIndex}>
      {(scale) => (
        <>
          {grouped.map((group) =>
            group.rows.length >= 2 ? (
              <polyline
                fill="none"
                key={`${group.playOrder}-line`}
                points={group.rows
                  .map((row) =>
                    [scale.x(row.matchIndex), scale.y(row.cumulativeAverageRankByPlayOrder)].join(
                      ",",
                    ),
                  )
                  .join(" ")}
                stroke={playOrderColor(group.playOrder)}
                strokeWidth="2.5"
              />
            ) : null,
          )}
          {grouped.flatMap((group) =>
            group.rows.map((row) => (
              <circle
                key={row.matchId}
                cx={scale.x(row.matchIndex)}
                cy={scale.y(row.cumulativeAverageRankByPlayOrder)}
                fill={playOrderColor(group.playOrder)}
                r="5"
                stroke="var(--color-surface)"
                strokeWidth="2"
              >
                <title>
                  {`${row.matchIndex}戦目 ${formatPlayOrderLabel(row.playOrder)} ${row.playOrderOccurrenceIndex}戦目平均 ${formatDecimal(row.cumulativeAverageRankByPlayOrder)}`}
                </title>
              </circle>
            )),
          )}
        </>
      )}
    </RankChartFrame>
  );
}

function RankChartFrame({
  ariaLabel,
  children,
  maxMatchIndex,
}: {
  ariaLabel: string;
  children: (scale: { x: (value: number) => number; y: (value: number) => number }) => ReactNode;
  maxMatchIndex: number;
}) {
  const width = 760;
  const height = 280;
  const padding = { bottom: 34, left: 42, right: 20, top: 18 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (value: number) =>
    padding.left + ((Math.max(1, value) - 1) / Math.max(1, maxMatchIndex - 1)) * plotWidth;
  const y = (value: number) => padding.top + ((value - 1) / 3) * plotHeight;
  return (
    <svg
      aria-label={ariaLabel}
      className="h-full min-h-72 w-full min-w-[48rem]"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      {[1, 2, 3, 4].map((rank) => (
        <g key={rank}>
          <line
            stroke="var(--color-border)"
            strokeDasharray={rank === 1 || rank === 4 ? "0" : "4 4"}
            x1={padding.left}
            x2={width - padding.right}
            y1={y(rank)}
            y2={y(rank)}
          />
          <text
            fill="var(--color-text-secondary)"
            fontSize="11"
            textAnchor="end"
            x={padding.left - 8}
            y={y(rank) + 4}
          >
            {rank}位
          </text>
        </g>
      ))}
      <line
        stroke="var(--color-border-strong)"
        x1={padding.left}
        x2={padding.left}
        y1={padding.top}
        y2={height - padding.bottom}
      />
      <line
        stroke="var(--color-border-strong)"
        x1={padding.left}
        x2={width - padding.right}
        y1={height - padding.bottom}
        y2={height - padding.bottom}
      />
      {chartXTicks(maxMatchIndex).map((matchIndex) => (
        <text
          fill="var(--color-text-secondary)"
          fontSize="11"
          key={matchIndex}
          textAnchor="middle"
          x={x(matchIndex)}
          y={height - 11}
        >
          {matchIndex}戦
        </text>
      ))}
      {children({ x, y })}
    </svg>
  );
}

function chartXTicks(maxMatchIndex: number): number[] {
  if (maxMatchIndex <= 1) {
    return [1];
  }
  const candidates = [
    1,
    Math.max(1, Math.round(maxMatchIndex * 0.25)),
    Math.max(1, Math.round(maxMatchIndex * 0.5)),
    Math.max(1, Math.round(maxMatchIndex * 0.75)),
    maxMatchIndex,
  ];
  return Array.from(new Set(candidates)).toSorted((a, b) => a - b);
}

function PlayOrderLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
      {[1, 2, 3, 4].map((playOrder) => (
        <span className="inline-flex items-center gap-1" key={playOrder}>
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: playOrderColor(playOrder) }}
          />
          {formatPlayOrderLabel(playOrder)}
        </span>
      ))}
    </div>
  );
}

function PlayOrderBreakdownTable({ rows }: { rows: PlayOrderRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="番手ごとの履歴がありません" description="対象試合がありません。" />;
  }
  return (
    <TableScroll ariaLabel="番手ごとの成績履歴">
      <table className="w-full min-w-[72rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <TableHeader className="sticky left-0 z-[calc(var(--z-sticky)+1)]">番手</TableHeader>
            <TableHeader align="right">対象戦数</TableHeader>
            <TableHeader align="right">平均順位</TableHeader>
            <TableHeader>順位分布</TableHeader>
            <TableHeader align="right">入賞率</TableHeader>
            <TableHeader align="right">下位率</TableHeader>
            <TableHeader align="right">全体同番手平均</TableHeader>
            <TableHeader>全体平均との差</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.playOrder}>
              <StickyCell>
                <PlayOrderPill playOrder={row.playOrder} />
              </StickyCell>
              <TableCell align="right">{row.matchCount}戦</TableCell>
              <TableCell align="right">{formatDecimal(row.rankAverage)}</TableCell>
              <TableCell>{formatRankDistribution(row.rankDistribution ?? [])}</TableCell>
              <TableCell align="right">
                {row.matchCount > 0
                  ? `${row.podiumCount}回・${formatPercent(row.podiumRate)}`
                  : "-"}
              </TableCell>
              <TableCell align="right">
                {row.matchCount > 0
                  ? `${row.lowerHalfCount}回・${formatPercent(row.lowerHalfRate)}`
                  : "-"}
              </TableCell>
              <TableCell align="right">{formatDecimal(row.baselineRankAverage)}</TableCell>
              <TableCell>
                <BaselineDeltaBadge value={row.baselineDelta} />
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function PlayOrderTrendTable({ rows }: { rows: TrendRow[] }) {
  const sortedRows = useMemo(() => rows.toSorted(compareTrendRowDesc), [rows]);
  if (rows.length === 0) {
    return <EmptyState title="推移データがありません" description="対象試合がありません。" />;
  }
  return (
    <TableScroll ariaLabel="番手別平均順位推移の実データ">
      <table className="w-full min-w-[78rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <TableHeader className="sticky left-0 z-[calc(var(--z-sticky)+1)]">対戦順</TableHeader>
            <TableHeader>開催</TableHeader>
            <TableHeader align="right">第n試合</TableHeader>
            <TableHeader>番手</TableHeader>
            <TableHeader align="right">番手内</TableHeader>
            <TableHeader align="right">順位</TableHeader>
            <TableHeader align="right">試合後平均</TableHeader>
            <TableHeader>平均変化</TableHeader>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.matchId}>
              <StickyCell>
                <span className="font-semibold tabular-nums">{row.matchIndex}戦目</span>
              </StickyCell>
              <TableCell>
                <span className="block">{formatDate(row.playedAt)}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">
                  {shortId(row.heldEventId)}
                </span>
              </TableCell>
              <TableCell align="right">第{row.matchNoInEvent}試合</TableCell>
              <TableCell>
                <PlayOrderPill playOrder={row.playOrder} />
              </TableCell>
              <TableCell align="right">{row.playOrderOccurrenceIndex}戦目</TableCell>
              <TableCell align="right">{row.rank}位</TableCell>
              <TableCell align="right">
                {formatDecimal(row.cumulativeAverageRankByPlayOrder)}
              </TableCell>
              <TableCell>
                <AverageDeltaBadge value={row.cumulativeAverageRankDeltaByPlayOrder} />
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function TableScroll({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <div
      aria-label={ariaLabel}
      className="h-full min-h-0 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      {children}
    </div>
  );
}

function TableHeader({
  align = "left",
  children,
  className,
}: {
  align?: "left" | "right";
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "sticky top-0 z-[var(--z-sticky)] border-b border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      scope="col"
    >
      {children}
    </th>
  );
}

function TableCell({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <td
      className={cn(
        "border-b border-[var(--color-border)] px-3 py-2.5 align-top text-[var(--color-text-primary)] tabular-nums group-last:border-b-0",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

function StickyCell({ children }: { children: ReactNode }) {
  return (
    <td className="sticky left-0 z-[var(--z-base)] border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 align-top text-[var(--color-text-primary)] tabular-nums group-last:border-b-0 group-hover:bg-[var(--color-surface-subtle)]">
      {children}
    </td>
  );
}

function PlayOrderPill({ playOrder }: { playOrder: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-0.5 text-xs font-semibold">
      <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={{ backgroundColor: playOrderColor(playOrder) }}
      />
      {formatPlayOrderLabel(playOrder)}
    </span>
  );
}

function BaselineDeltaBadge({ value }: { value: number | null | undefined }) {
  if (!isNumber(value)) {
    return <span className="text-[var(--color-text-muted)]">-</span>;
  }
  const tone = value < 0 ? "good" : value > 0 ? "heavy" : "flat";
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-[var(--radius-xs)] border px-2 py-0.5 text-xs font-semibold tabular-nums",
        tone === "good" &&
          "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-text-primary)]",
        tone === "heavy" &&
          "border-[var(--color-review)]/45 bg-[var(--color-review)]/10 text-[var(--color-text-primary)]",
        tone === "flat" &&
          "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
      )}
    >
      {Math.abs(value).toFixed(2)} {baselineDeltaLabel(tone)}
    </span>
  );
}

function AverageDeltaBadge({ value }: { value: number | null | undefined }) {
  if (!isNumber(value)) {
    return <span className="text-[var(--color-text-muted)]">-</span>;
  }
  const tone = value < 0 ? "good" : value > 0 ? "heavy" : "flat";
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-[var(--radius-xs)] border px-2 py-0.5 text-xs font-semibold tabular-nums",
        tone === "good" &&
          "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-text-primary)]",
        tone === "heavy" &&
          "border-[var(--color-review)]/45 bg-[var(--color-review)]/10 text-[var(--color-text-primary)]",
        tone === "flat" &&
          "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
      )}
    >
      {Math.abs(value).toFixed(2)} {averageDeltaLabel(tone)}
    </span>
  );
}

function baselineDeltaLabel(tone: "flat" | "good" | "heavy"): string {
  switch (tone) {
    case "good":
      return "良い";
    case "heavy":
      return "重い";
    case "flat":
      return "同等";
  }
}

function averageDeltaLabel(tone: "flat" | "good" | "heavy"): string {
  switch (tone) {
    case "good":
      return "改善";
    case "heavy":
      return "後退";
    case "flat":
      return "維持";
  }
}

function formatPlayOrderSummaryValue(
  playOrder: number | null | undefined,
  averageRank: number | null | undefined,
): string {
  if (!isNumber(playOrder) || !isNumber(averageRank)) {
    return "-";
  }
  return `${formatPlayOrderLabel(playOrder)} 平均${formatDecimal(averageRank)}`;
}

function formatCountsByPlayOrder(rows: Array<{ matchCount: number; playOrder: number }>): string {
  if (rows.length === 0) {
    return "-";
  }
  return rows
    .map((row) => `${formatPlayOrderLabel(row.playOrder)} ${row.matchCount}戦`)
    .join(" / ");
}

function formatRankDistribution(
  rows: Array<{ count: number; rank: number; rate?: number | undefined }>,
): string {
  if (rows.length === 0) {
    return "-";
  }
  return rows.map((row) => `${row.rank}位 ${row.count}回`).join(" / ");
}

function compareTrendRowDesc(left: TrendRow, right: TrendRow): number {
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
