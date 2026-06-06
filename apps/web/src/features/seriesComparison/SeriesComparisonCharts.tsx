import type { CSSProperties } from "react";

import {
  formatPercent,
  formatSigned,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { cn } from "@/shared/ui/cn";

import {
  headToHeadBands,
  headToHeadRankDiffSignal,
  SERIES_COMPARISON_THRESHOLDS,
} from "./seriesComparisonThresholds";

type Player = NonNullable<SeriesComparisonResponse["players"]>[number];
type TrendSeries = NonNullable<SeriesComparisonResponse["trends"]["rankCumulativeAverage"]>[number];
type Histogram = SeriesComparisonResponse["histograms"]["assets"];
type HistogramBin = NonNullable<Histogram["bins"]>[number];
type HeadToHeadEntry = NonNullable<SeriesComparisonResponse["headToHead"]["entries"]>[number];
type MatchPlayerPoint = NonNullable<SeriesComparisonResponse["matchPlayerPoints"]>[number];
type PlayerPerformanceProfiles = SeriesComparisonResponse["playerPerformanceProfiles"];

const palette = ["#2563eb", "#dc2626", "#d9a300", "#16a34a", "#6f7d74", "#7b5aa6"];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function playerColor(index: number): string {
  return palette[index % palette.length] ?? "#2563eb";
}

export function PlayerLegend({
  players,
  variant = "point",
}: {
  players: Player[];
  variant?: "point" | "line";
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
      {players.map((player, index) => (
        <span key={player.memberId} className="inline-flex items-center gap-1.5">
          {variant === "line" ? (
            <svg aria-hidden="true" className="size-7" viewBox="0 0 28 12">
              <line
                stroke={playerColor(index)}
                strokeLinecap="round"
                strokeWidth="2"
                x1="2"
                x2="26"
                y1="6"
                y2="6"
              />
            </svg>
          ) : (
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: playerColor(index) }}
            />
          )}
          <span className="font-medium text-[var(--color-text-primary)]">{player.displayName}</span>
        </span>
      ))}
    </div>
  );
}

export function LineChart({
  className,
  ariaLabel,
  domain,
  formatValue,
  lowValueAtTop = false,
  minYStep = 1,
  players,
  series,
  yTicks,
}: {
  className?: string;
  ariaLabel: string;
  domain?: [number, number];
  formatValue: (value: number) => string;
  lowValueAtTop?: boolean;
  minYStep?: number;
  players: Player[];
  series: TrendSeries[];
  yTicks?: number[];
}) {
  const width = 760;
  const height = 300;
  const padding = { bottom: 42, left: 54, right: 24, top: 24 };
  const values = series.flatMap((item) =>
    (item.points ?? []).flatMap((point) => (isFiniteNumber(point.value) ? [point.value] : [])),
  );
  const maxIndex = Math.max(
    1,
    ...series.flatMap((item) => (item.points ?? []).map((point) => point.index)),
  );
  const minValue = domain?.[0] ?? 0;
  const observedMaxValue = values.length === 0 ? 1 : Math.max(...values);
  const maxValue =
    domain?.[1] ??
    niceCeil(observedMaxValue <= minValue ? minValue + 1 : observedMaxValue, minYStep);
  const ySpan = maxValue === minValue ? 1 : maxValue - minValue;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const playerIndex = new Map(players.map((player, index) => [player.memberId, index]));
  const x = (index: number) =>
    padding.left + ((index - 1) / Math.max(1, maxIndex - 1)) * chartWidth;
  const y = (value: number) => {
    const ratio = (value - minValue) / ySpan;
    return padding.top + (lowValueAtTop ? ratio : 1 - ratio) * chartHeight;
  };
  const ticks = yTicks ?? buildNumberTicks(minValue, maxValue, 5, minYStep);
  const xTicks = buildIndexTicks(maxIndex, 6);

  return (
    <figure className={cn("grid gap-2", className)}>
      <div className="flex overflow-x-auto pb-1 md:justify-center">
        <svg
          aria-label={ariaLabel}
          className="w-[760px] max-w-none shrink-0 overflow-visible rounded-[var(--radius-sm)] bg-[var(--color-surface)] md:w-full md:max-w-[980px]"
          role="img"
          style={{ aspectRatio: `${width} / ${height}` }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            stroke="var(--color-border-strong)"
            strokeWidth="1"
            x1={padding.left}
            x2={width - padding.right}
            y1={height - padding.bottom}
            y2={height - padding.bottom}
          />
          <line
            stroke="var(--color-border)"
            strokeWidth="1"
            x1={padding.left}
            x2={padding.left}
            y1={padding.top}
            y2={height - padding.bottom}
          />
          {ticks.map((value) => (
            <g key={value}>
              <line
                stroke="var(--color-border)"
                strokeDasharray="4 4"
                strokeWidth="0.8"
                x1={padding.left}
                x2={width - padding.right}
                y1={y(value)}
                y2={y(value)}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="12"
                textAnchor="end"
                x={padding.left - 8}
                y={y(value) + 4}
              >
                {formatValue(value)}
              </text>
            </g>
          ))}
          {xTicks.map((value) => {
            const xPosition = x(value);
            return (
              <g key={value}>
                {value !== 1 && value !== maxIndex ? (
                  <line
                    stroke="var(--color-border)"
                    strokeDasharray="4 4"
                    strokeWidth="0.8"
                    x1={xPosition}
                    x2={xPosition}
                    y1={padding.top}
                    y2={height - padding.bottom}
                  />
                ) : null}
                <text
                  fill="var(--color-text-secondary)"
                  fontSize="12"
                  textAnchor={value === maxIndex ? "end" : value === 1 ? "start" : "middle"}
                  x={xPosition}
                  y={height - 8}
                >
                  {value === maxIndex ? `${value}戦` : value}
                </text>
              </g>
            );
          })}
          {series.map((item) => {
            const points = (item.points ?? []).flatMap((point) =>
              isFiniteNumber(point.value) ? [{ index: point.index, value: point.value }] : [],
            );
            const seriesIndex = playerIndex.get(item.memberId) ?? 0;
            const playerName = players.find(
              (player) => player.memberId === item.memberId,
            )?.displayName;
            const latestPoint = points.reduce<{ index: number; value: number } | null>(
              (latest, point) => (latest === null || point.index > latest.index ? point : latest),
              null,
            );
            const latestLabel =
              latestPoint === null ? "データなし" : `最新 ${formatValue(latestPoint.value)}`;
            const path = points
              .map(
                (point, pointIndex) =>
                  `${pointIndex === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value)}`,
              )
              .join(" ");
            const color = playerColor(seriesIndex);
            return (
              <g key={item.memberId}>
                <title>{`${playerName ?? "社長"}、${latestLabel}`}</title>
                <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeWidth="1.8" />
                {points.length <= 32
                  ? points.map((point) => (
                      <circle
                        key={`${item.memberId}-${point.index}`}
                        cx={x(point.index)}
                        cy={y(point.value)}
                        fill={color}
                        r="2.4"
                      />
                    ))
                  : null}
              </g>
            );
          })}
        </svg>
      </div>
      <PlayerLegend players={players} variant="line" />
    </figure>
  );
}

export function HistogramChart({
  className,
  histogram,
  players,
}: {
  className?: string;
  histogram: Histogram;
  players: Player[];
}) {
  const bins = histogram.bins ?? [];
  const series = histogram.series ?? [];
  const maxValue = Math.max(1, ...series.flatMap((item) => item.counts ?? []));
  const seriesByMember = new Map(series.map((item) => [item.memberId, item.counts ?? []]));

  return (
    <figure className={cn("grid gap-3", className)}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {players.map((player, index) => (
          <SingleHistogram
            key={player.memberId}
            bins={bins}
            color={playerColor(index)}
            counts={seriesByMember.get(player.memberId) ?? []}
            maxValue={maxValue}
            player={player}
          />
        ))}
      </div>
      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
        金額の区切りと縦軸は全員共通です。
      </p>
    </figure>
  );
}

export function HeadToHeadMatrix({
  entries,
  players,
}: {
  entries: HeadToHeadEntry[];
  players: Player[];
}) {
  const entryByPair = new Map(
    entries.map((entry) => [`${entry.subjectMemberId}:${entry.opponentMemberId}`, entry]),
  );

  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="grid min-w-[42rem] gap-1"
        style={{
          gridTemplateColumns: `9rem repeat(${Math.max(1, players.length)}, minmax(7rem, 1fr))`,
        }}
      >
        <div aria-hidden="true" />
        {players.map((player) => (
          <div
            key={player.memberId}
            className="truncate rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1.5 text-center text-xs font-semibold text-[var(--color-text-primary)]"
          >
            vs {player.displayName}
          </div>
        ))}
        {players.map((subject, rowIndex) => (
          <MatrixRow
            key={subject.memberId}
            entryByPair={entryByPair}
            players={players}
            rowIndex={rowIndex}
            subject={subject}
          />
        ))}
      </div>
    </div>
  );
}

function MatrixRow({
  entryByPair,
  players,
  rowIndex,
  subject,
}: {
  entryByPair: Map<string, HeadToHeadEntry>;
  players: Player[];
  rowIndex: number;
  subject: Player;
}) {
  return (
    <>
      <div
        className="truncate rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-2 text-sm font-semibold text-[var(--color-text-primary)]"
        style={{ borderLeftColor: playerColor(rowIndex), borderLeftWidth: 3 }}
      >
        {subject.displayName}
      </div>
      {players.map((opponent) => {
        const entry = entryByPair.get(`${subject.memberId}:${opponent.memberId}`);
        const rate = entry?.betterRankRate;
        const matchCount = entry?.matchCount;
        const tone = headToHeadCellTone(rate, matchCount, entry?.averageRankDiff);
        const isSelf = subject.memberId === opponent.memberId;
        return (
          <div
            key={opponent.memberId}
            className="min-h-16 rounded-[var(--radius-xs)] border border-[var(--color-border)] px-2 py-2 text-center"
            style={{
              backgroundColor: isSelf
                ? "var(--color-surface-subtle)"
                : `rgba(${tone.rgb}, ${tone.alpha})`,
              borderColor: isSelf
                ? "var(--color-border)"
                : `rgba(${tone.rgb}, ${tone.borderAlpha})`,
            }}
          >
            {isSelf ? (
              <span className="text-xs text-[var(--color-text-muted)]">-</span>
            ) : (
              <>
                <div className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                  {formatPercent(rate)}
                </div>
                <div className="mt-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                  {headToHeadToneLabel(rate, matchCount, entry?.averageRankDiff)}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                  {entry?.betterRankCount ?? 0}/{entry?.matchCount ?? 0}戦
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                  順位差 {formatSigned(entry?.averageRankDiff)}
                </div>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

export function headToHeadCellTone(
  rate: number | null | undefined,
  matchCount?: number,
  averageRankDiff?: number | null,
): {
  alpha: number;
  borderAlpha: number;
  rgb: string;
} {
  const bands = headToHeadBands(matchCount);
  if (
    matchCount != null &&
    matchCount > 0 &&
    matchCount <= SERIES_COMPARISON_THRESHOLDS.headToHead.referenceMaxMatchCount
  ) {
    return { alpha: 0.08, borderAlpha: 0.2, rgb: "108, 117, 125" };
  }
  if (!isFiniteNumber(rate)) {
    return { alpha: 0, borderAlpha: 0.14, rgb: "111, 125, 116" };
  }
  if (rate > bands.slightDisadvantageTo && rate < bands.slightAdvantageFrom) {
    const rankDiffSignal = headToHeadRankDiffSignal(averageRankDiff, matchCount);
    if (rankDiffSignal === "strong_positive" || rankDiffSignal === "slight_positive") {
      return directionalHeadToHeadTone("positive", averageRankDiff);
    }
    if (rankDiffSignal === "strong_negative" || rankDiffSignal === "slight_negative") {
      return directionalHeadToHeadTone("negative", averageRankDiff);
    }
    return { alpha: 0.08, borderAlpha: 0.2, rgb: "108, 117, 125" };
  }
  const distance = Math.abs(rate - 0.5);
  const alpha = Math.min(0.46, distance < 0.001 ? 0.04 : 0.1 + distance * 0.92);
  return rate >= 0.5
    ? { alpha, borderAlpha: Math.min(0.66, alpha + 0.16), rgb: "37, 99, 235" }
    : { alpha, borderAlpha: Math.min(0.66, alpha + 0.16), rgb: "220, 38, 38" };
}

function directionalHeadToHeadTone(
  direction: "negative" | "positive",
  averageRankDiff: number | null | undefined,
): {
  alpha: number;
  borderAlpha: number;
  rgb: string;
} {
  const distance = Math.min(
    0.22,
    Math.max(0.06, Math.abs(isFiniteNumber(averageRankDiff) ? averageRankDiff : 0) * 0.42),
  );
  const alpha = Math.min(0.46, 0.1 + distance * 0.92);
  return direction === "positive"
    ? { alpha, borderAlpha: Math.min(0.66, alpha + 0.16), rgb: "37, 99, 235" }
    : { alpha, borderAlpha: Math.min(0.66, alpha + 0.16), rgb: "220, 38, 38" };
}

export function headToHeadToneLabel(
  rate: number | null | undefined,
  matchCount?: number,
  averageRankDiff?: number | null,
): string {
  const bands = headToHeadBands(matchCount);
  if (
    matchCount != null &&
    matchCount > 0 &&
    matchCount <= SERIES_COMPARISON_THRESHOLDS.headToHead.referenceMaxMatchCount
  ) {
    return "参考";
  }
  if (matchCount === 0) {
    return "判定なし";
  }
  if (!isFiniteNumber(rate)) {
    return "判定なし";
  }
  if (rate >= bands.strongAdvantageFrom) {
    return "優勢";
  }
  if (rate >= bands.slightAdvantageFrom) {
    return "やや優勢";
  }
  if (rate <= bands.strongDisadvantageTo) {
    return "劣勢";
  }
  if (rate <= bands.slightDisadvantageTo) {
    return "やや劣勢";
  }
  const rankDiffSignal = headToHeadRankDiffSignal(averageRankDiff, matchCount);
  if (rankDiffSignal === "strong_positive") {
    return "優勢";
  }
  if (rankDiffSignal === "slight_positive") {
    return "やや優勢";
  }
  if (rankDiffSignal === "strong_negative") {
    return "劣勢";
  }
  if (rankDiffSignal === "slight_negative") {
    return "やや劣勢";
  }
  return "互角";
}

export function StrategyScatterPlot({
  players,
  points,
}: {
  players: Player[];
  points: MatchPlayerPoint[];
}) {
  const width = 760;
  const height = 330;
  const padding = { bottom: 64, left: 68, right: 24, top: 22 };
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
    <figure className="grid gap-2">
      <div className="flex overflow-x-auto pb-1 md:justify-center">
        <svg
          aria-label="物件収益比率と総資産の散布図"
          className="w-[760px] max-w-none shrink-0 overflow-visible rounded-[var(--radius-sm)] bg-[var(--color-surface)] md:w-full md:max-w-[980px]"
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
                y={height - 28}
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
            textAnchor="end"
            x={width - padding.right}
            y={height - 8}
          >
            物件収益÷総資産
          </text>
          <text fill="var(--color-text-secondary)" fontSize="12" x={8} y={padding.top + 2}>
            総資産
          </text>
          {plottedPoints.map((point) => {
            const color = playerColor(playerIndex.get(point.memberId) ?? 0);
            return (
              <circle
                key={`${point.matchId}-${point.memberId}`}
                cx={x(point.revenueAssetRate ?? 0)}
                cy={y(point.totalAssets)}
                fill={color}
                opacity="0.78"
                r="4"
              >
                <title>
                  {`${playerName.get(point.memberId) ?? point.memberId}、${point.matchIndex}戦目、物件収益比率 ${formatPercent(point.revenueAssetRate)}、総資産 ${formatCompactManYen(point.totalAssets)}、${point.rank}位`}
                </title>
              </circle>
            );
          })}
        </svg>
      </div>
      <p className="text-center text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
        左ほど遊戯王型（カード重視）、右ほど桃鉄型（物件重視）です。
      </p>
      <PlayerLegend players={players} />
    </figure>
  );
}

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
                <circle
                  cx={x(entry.averageRevenueAssetRate)}
                  cy={y(entry.averageRankScore)}
                  fill={color}
                  r="5"
                >
                  <title>
                    {`${playerName.get(entry.memberId) ?? entry.memberId}、物件収益比率 ${formatPercent(entry.averageRevenueAssetRate)}、順位スコア ${entry.averageRankScore.toFixed(2)}`}
                  </title>
                </circle>
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

function SingleHistogram({
  bins,
  color,
  counts,
  maxValue,
  player,
}: {
  bins: HistogramBin[];
  color: string;
  counts: number[];
  maxValue: number;
  player: Player;
}) {
  const width = 320;
  const height = 220;
  const padding = { bottom: 56, left: 36, right: 16, top: 18 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const binWidth = chartWidth / Math.max(1, bins.length);
  const barWidth = Math.max(10, binWidth * 0.62);
  const countCeil = niceCeil(maxValue, 1);
  const countTicks = buildNumberTicks(0, countCeil, 5, 1);

  return (
    <div className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{player.displayName}</span>
      </div>
      <svg
        aria-label={`${player.displayName}のヒストグラム`}
        className="h-52 w-full overflow-visible rounded-[var(--radius-sm)] bg-[var(--color-surface)]"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          stroke="var(--color-border-strong)"
          strokeWidth="1"
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
        />
        {countTicks.map((tick) => {
          const y = height - padding.bottom - (tick / countCeil) * chartHeight;
          return (
            <g key={tick}>
              <line
                stroke="var(--color-border)"
                strokeDasharray={tick === 0 ? undefined : "4 4"}
                strokeWidth="0.8"
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="11"
                textAnchor="end"
                x={padding.left - 8}
                y={y + 4}
              >
                {tick}
              </text>
            </g>
          );
        })}
        {bins.map((bin, binIndex) => {
          const value = counts[binIndex] ?? 0;
          const barHeight = (value / countCeil) * chartHeight;
          return (
            <g key={bin.index}>
              <rect
                fill={color}
                height={barHeight}
                rx="2"
                width={barWidth}
                x={padding.left + binIndex * binWidth + (binWidth - barWidth) / 2}
                y={height - padding.bottom - barHeight}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="10"
                textAnchor="end"
                transform={`rotate(-30 ${padding.left + binIndex * binWidth + binWidth / 2} ${height - 16})`}
                x={padding.left + binIndex * binWidth + binWidth / 2}
                y={height - 16}
              >
                {formatHistogramBinLabel(bin)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function formatHistogramBinLabel(bin: HistogramBin): string {
  const lower = formatCompactManYen(bin.lowerInclusive ?? 0);
  if (bin.upperExclusive == null) {
    return `${lower}+`;
  }
  return `${lower}〜${formatCompactManYen(bin.upperExclusive)}`;
}

function medianNumber(values: number[]): number | undefined {
  const sorted = values.toSorted((a, b) => a - b);
  if (sorted.length === 0) {
    return undefined;
  }
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function formatCompactManYen(value: number): string {
  if (value === 0) {
    return "0";
  }
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 10000) {
    return `${sign}${formatCompactNumber(abs / 10000)}億`;
  }
  return `${value}万`;
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function buildNumberTicks(
  minValue: number,
  maxValue: number,
  maxTickCount: number,
  minStep = 0,
): number[] {
  const span = Math.max(Number.EPSILON, maxValue - minValue);
  const rawStep = span / Math.max(1, maxTickCount - 1);
  const step = niceStep(rawStep, minStep);
  const first = Math.ceil(minValue / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= maxValue + step * 0.001; value += step) {
    ticks.push(Number(value.toFixed(4)));
  }
  if (!ticks.includes(minValue)) {
    ticks.unshift(minValue);
  }
  if (!ticks.includes(maxValue)) {
    ticks.push(maxValue);
  }
  return Array.from(new Set(ticks)).toSorted((a, b) => a - b);
}

function buildIndexTicks(maxIndex: number, maxTickCount: number): number[] {
  if (maxIndex <= 1) {
    return [1];
  }
  const step = niceStep((maxIndex - 1) / Math.max(1, maxTickCount - 1), 1);
  const ticks = [1];
  for (let value = Math.ceil(2 / step) * step; value < maxIndex; value += step) {
    ticks.push(value);
  }
  ticks.push(maxIndex);
  return Array.from(new Set(ticks.map((value) => Math.round(value)))).toSorted((a, b) => a - b);
}

function niceCeil(value: number, minStep = 0): number {
  const step = niceStep(value / 4, minStep);
  return Math.max(step, Math.ceil(value / step) * step);
}

function niceStep(rawStep: number, minStep = 0): number {
  const safeStep = Math.max(rawStep, Number.EPSILON);
  const magnitude = 10 ** Math.floor(Math.log10(safeStep));
  const normalized = safeStep / magnitude;
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return Math.max(factor * magnitude, minStep);
}

export function playerGridStyle(playerCount: number): CSSProperties {
  return { "--player-count": String(Math.max(1, playerCount)) } as CSSProperties;
}
