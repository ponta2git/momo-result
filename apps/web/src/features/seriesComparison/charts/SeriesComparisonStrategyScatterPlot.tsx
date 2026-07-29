import {
  PlayerLegend,
  PlayerPointMark,
} from "@/features/seriesComparison/charts/SeriesComparisonChartLegend";
import {
  buildNumberTicks,
  formatCompactManYen,
  niceCeil,
} from "@/features/seriesComparison/charts/SeriesComparisonChartScales";
import type {
  MatchPlayerPoint,
  Player,
} from "@/features/seriesComparison/charts/SeriesComparisonChartTypes";
import { isFiniteNumber } from "@/features/seriesComparison/charts/SeriesComparisonChartTypes";
import { formatPercent } from "@/features/seriesComparison/model/seriesComparisonPresentation";

export function StrategyScatterPlot({
  focusedMatchId,
  players,
  points,
}: {
  focusedMatchId?: string | undefined;
  players: Player[];
  points: MatchPlayerPoint[];
}) {
  const width = 760;
  const height = 350;
  const padding = { bottom: 68, left: 88, right: 88, top: 24 };
  const plottedPoints = points.filter(
    (point) => isFiniteNumber(point.revenueAssetRate) && isFiniteNumber(point.totalAssets),
  );
  const valuesX = plottedPoints.map((point) => point.revenueAssetRate).filter(isFiniteNumber);
  const valuesY = plottedPoints.map((point) => point.totalAssets).filter(isFiniteNumber);
  const minX = 0;
  const maxX = valuesX.length === 0 ? 1 : niceCeil(Math.max(0.1, ...valuesX), 0.05);
  const minY = valuesY.length === 0 ? 0 : Math.min(0, ...valuesY);
  const maxY = valuesY.length === 0 ? 1 : niceCeil(Math.max(...valuesY), 1);
  const xSpan = Math.max(0.0001, maxX - minX);
  const ySpan = Math.max(1, maxY - minY);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const playerIndex = new Map(players.map((player, index) => [player.memberId, index]));
  const playerName = new Map(players.map((player) => [player.memberId, player.displayName]));
  const x = (value: number) => padding.left + ((value - minX) / xSpan) * chartWidth;
  const y = (value: number) => padding.top + (1 - (value - minY) / ySpan) * chartHeight;
  const xTicks = buildNumberTicks(minX, maxX, 5, 0.05);
  const yTicks = buildNumberTicks(minY, maxY, 5, 1);

  return (
    <figure className="grid max-w-full min-w-0 gap-2">
      <div className="flex max-w-full min-w-0 overflow-x-auto pb-1 md:justify-center">
        <svg
          aria-label="物件収益比率と総資産の散布図"
          className="w-[760px] max-w-none shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-surface)] md:w-full md:max-w-[980px]"
          role="img"
          style={{ aspectRatio: `${width} / ${height}` }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            stroke="var(--color-border-strong)"
            x1={padding.left}
            x2={width - padding.right}
            y1={height - padding.bottom}
            y2={height - padding.bottom}
          />
          <line
            stroke="var(--color-border)"
            x1={padding.left}
            x2={padding.left}
            y1={padding.top}
            y2={height - padding.bottom}
          />
          {xTicks.map((tick) => (
            <g key={`x-${tick}`}>
              <line
                stroke="var(--color-border)"
                strokeDasharray="4 4"
                x1={x(tick)}
                x2={x(tick)}
                y1={padding.top}
                y2={height - padding.bottom}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="11"
                textAnchor="middle"
                x={x(tick)}
                y={height - padding.bottom + 20}
              >
                {formatPercent(tick)}
              </text>
            </g>
          ))}
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                stroke="var(--color-border)"
                strokeDasharray="4 4"
                x1={padding.left}
                x2={width - padding.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="11"
                textAnchor="end"
                x={padding.left - 8}
                y={y(tick) + 4}
              >
                {formatCompactManYen(tick)}
              </text>
            </g>
          ))}
          <text
            fill="var(--color-text-secondary)"
            fontSize="12"
            textAnchor="middle"
            x={padding.left + chartWidth / 2}
            y={height - 12}
          >
            物件収益÷総資産
          </text>
          <text
            fill="var(--color-text-secondary)"
            fontSize="12"
            textAnchor="middle"
            transform={`rotate(-90 18 ${padding.top + chartHeight / 2})`}
            x={18}
            y={padding.top + chartHeight / 2}
          >
            総資産
          </text>
          {plottedPoints.map((point) => {
            const index = playerIndex.get(point.memberId) ?? 0;
            const focused = focusedMatchId === point.matchId;
            return (
              <g
                key={`${point.matchId}-${point.memberId}`}
                aria-label={focused ? `${point.matchIndex}戦目を選択中` : undefined}
                className={focused ? "momo-enter" : undefined}
                data-focused-match={focused || undefined}
              >
                {focused ? (
                  <circle
                    cx={x(point.revenueAssetRate ?? 0)}
                    cy={y(point.totalAssets)}
                    fill="var(--color-surface)"
                    fillOpacity="0.82"
                    r="8"
                    stroke="var(--color-action)"
                    strokeWidth="2"
                  />
                ) : null}
                <PlayerPointMark
                  cx={x(point.revenueAssetRate ?? 0)}
                  cy={y(point.totalAssets)}
                  index={index}
                  opacity={focused ? 1 : focusedMatchId ? 0.55 : 0.8}
                  size={focused ? 5 : 4}
                >
                  <title>
                    {`${playerName.get(point.memberId) ?? point.memberId}、${point.matchIndex}戦目、物件収益比率 ${formatPercent(point.revenueAssetRate)}、総資産 ${formatCompactManYen(point.totalAssets)}、${point.rank}位${focused ? "、選択中" : ""}`}
                  </title>
                </PlayerPointMark>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-center text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
        1点は、1人が1試合で残した物件収益比率と総資産です。
        {focusedMatchId ? " 縁取りは選択中の試合です。" : ""}
      </p>
      <PlayerLegend players={players} />
    </figure>
  );
}
