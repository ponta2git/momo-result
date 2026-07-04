import { motion } from "motion/react";

import { PlayerLegend } from "@/features/seriesComparison/SeriesComparisonChartLegend";
import { medianNumber } from "@/features/seriesComparison/SeriesComparisonChartScales";
import type {
  Player,
  PlayerPerformanceProfiles,
} from "@/features/seriesComparison/SeriesComparisonChartTypes";
import { isFiniteNumber } from "@/features/seriesComparison/SeriesComparisonChartTypes";
import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import { formatPercent } from "@/features/seriesComparison/seriesComparisonPresentation";
import { momoTransition } from "@/shared/ui/motion/variants";

export function StrategyProfileChart({
  players,
  profiles,
}: {
  players: Player[];
  profiles: PlayerPerformanceProfiles;
}) {
  const entries = profiles.entries ?? [];
  const width = 560;
  const height = 300;
  const padding = { bottom: 56, left: 58, right: 18, top: 18 };
  const rates = entries.map((entry) => entry.averageRevenueAssetRate).filter(isFiniteNumber);
  const rateMedian = profiles.averageRevenueAssetRateMedian ?? medianNumber(rates) ?? 0.25;
  const rateSpan = Math.max(0.06, ...rates.map((rate) => Math.abs(rate - rateMedian)));
  const minRate = rateMedian - rateSpan;
  const maxRate = rateMedian + rateSpan;
  const minReturn = 1;
  const maxReturn = 4;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const returnMedian = profiles.averageRankScoreMedian ?? 2.5;
  const playerIndex = new Map(players.map((player, index) => [player.memberId, index]));
  const playerName = new Map(players.map((player) => [player.memberId, player.displayName]));
  const x = (value: number) =>
    padding.left + ((value - minRate) / Math.max(0.0001, maxRate - minRate)) * chartWidth;
  const y = (value: number) =>
    padding.top + (1 - (value - minReturn) / (maxReturn - minReturn)) * chartHeight;

  return (
    <figure className="grid gap-2">
      <div className="flex overflow-x-auto pb-1 md:justify-center">
        <svg
          aria-label="物件カード軸と順位スコア"
          className="w-[560px] max-w-none shrink-0 overflow-visible rounded-[var(--radius-sm)] bg-[var(--color-surface)]"
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
          <line
            stroke="var(--color-border-strong)"
            strokeDasharray="5 5"
            x1={x(rateMedian)}
            x2={x(rateMedian)}
            y1={padding.top}
            y2={height - padding.bottom}
          />
          <line
            stroke="var(--color-border-strong)"
            strokeDasharray="5 5"
            x1={padding.left}
            x2={width - padding.right}
            y1={y(returnMedian)}
            y2={y(returnMedian)}
          />
          <text
            fill="var(--color-text-secondary)"
            fontSize="11"
            x={padding.left + 8}
            y={padding.top + 16}
          >
            遊戯王型で上位
          </text>
          <text
            fill="var(--color-text-secondary)"
            fontSize="11"
            textAnchor="end"
            x={width - padding.right - 8}
            y={padding.top + 16}
          >
            桃鉄型で上位
          </text>
          <text
            fill="var(--color-text-secondary)"
            fontSize="11"
            x={padding.left + 8}
            y={height - padding.bottom - 10}
          >
            遊戯王型で下位
          </text>
          <text
            fill="var(--color-text-secondary)"
            fontSize="11"
            textAnchor="end"
            x={width - padding.right - 8}
            y={height - padding.bottom - 10}
          >
            桃鉄型で下位
          </text>
          {entries.map((entry) => {
            if (
              !isFiniteNumber(entry.averageRevenueAssetRate) ||
              !isFiniteNumber(entry.averageRankScore)
            ) {
              return null;
            }
            const color = playerColor(playerIndex.get(entry.memberId) ?? 0);
            return (
              <g key={entry.memberId}>
                <motion.circle
                  animate={{ opacity: 1, scale: 1 }}
                  cx={x(entry.averageRevenueAssetRate)}
                  cy={y(entry.averageRankScore)}
                  fill={color}
                  initial={{ opacity: 0, scale: 0.7 }}
                  r="5"
                  transition={momoTransition}
                >
                  <title>
                    {`${playerName.get(entry.memberId) ?? entry.memberId}、物件収益比率 ${formatPercent(entry.averageRevenueAssetRate)}、順位スコア ${entry.averageRankScore.toFixed(2)}`}
                  </title>
                </motion.circle>
              </g>
            );
          })}
          <text
            fill="var(--color-text-secondary)"
            fontSize="12"
            textAnchor="end"
            x={width - padding.right}
            y={height - 10}
          >
            物件収益比率
          </text>
          <text fill="var(--color-text-secondary)" fontSize="12" x={8} y={padding.top + 2}>
            順位スコア
          </text>
        </svg>
      </div>
      <p className="text-center text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
        縦線は4人の物件収益比率中央値、横線は順位スコア中央値です。
      </p>
      <PlayerLegend players={players} />
    </figure>
  );
}
