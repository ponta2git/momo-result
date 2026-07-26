import type { ReactNode } from "react";

import type {
  PlayOrderPayload,
  PlayOrderTableView,
  PlayOrderTrendRow,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonPlayOrderDrilldownTypes";
import {
  PlayOrderBreakdownTable,
  PlayOrderTrendTable,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonPlayOrderTables";
import {
  formatDecimal,
  formatPlayOrderLabel,
  playOrderColor,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

export function AverageTrendPanel({
  payload,
  tableView,
  onTableViewChange,
}: {
  payload: PlayOrderPayload;
  tableView: PlayOrderTableView;
  onTableViewChange: (value: PlayOrderTableView) => void;
}) {
  const rows = payload.averageTrendRows ?? [];
  if (rows.length === 0) {
    return <EmptyState title="推移データがありません" description="対象試合がありません。" />;
  }
  return (
    <div className="grid min-h-0 grid-rows-[auto_auto_minmax(14rem,20rem)] gap-3 lg:h-full lg:grid-rows-[minmax(14rem,20rem)_auto_minmax(0,1fr)]">
      <div className="h-[22rem] overflow-x-auto overflow-y-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 lg:h-auto lg:min-h-0 lg:overflow-auto">
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
          onValueChange={(next) => onTableViewChange(next as PlayOrderTableView)}
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

function CumulativeRankChart({ rows }: { rows: PlayOrderTrendRow[] }) {
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
      className="h-72 min-h-72 w-full min-w-[48rem] lg:h-full"
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
