import { useId, useLayoutEffect, useRef, useState } from "react";

import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import {
  playerRadarAxes,
  playerAchievementAxis,
  playerRadarScoreLabel,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import type {
  PlayerAchievementScore,
  PlayerRadarPlayer,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import { dataVizSeriesPresentation } from "@/shared/seriesAnalysis/seriesPresentation";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

const ticks = [2, 4, 6, 8, 10];

function coordinate(
  center: { x: number; y: number },
  index: number,
  distance: number,
  axisCount: number,
) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / axisCount;
  return {
    x: center.x + Math.cos(angle) * distance,
    y: center.y + Math.sin(angle) * distance,
  };
}

/** Geometry only: all values, scores, and sample judgements come from the saved result. */
export function PlayerRadarChart({
  player,
  referenceScoresGrouped,
  comparison,
  achievement,
}: {
  player: PlayerRadarPlayer;
  referenceScoresGrouped: boolean;
  comparison?: { before: PlayerRadarPlayer | null } | undefined;
  achievement?: PlayerAchievementScore | undefined;
}) {
  const figureId = useId();
  const figureRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    const measure = () => {
      const nextWidth = figure.getBoundingClientRect().width;
      if (nextWidth > 0) setWidth(nextWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(figure);
    return () => observer.disconnect();
  }, []);
  // Keep text and marks in CSS pixels; resize the geometry inside its allotted column.
  const axes = achievement ? [...playerRadarAxes, playerAchievementAxis] : playerRadarAxes;
  const radius = Math.max(
    24,
    Math.min(128, achievement ? width / 2 - 76 : (width / 2 - 36) / Math.cos(Math.PI / 6) - 36),
  );
  const center = { x: width / 2, y: radius + 70 };
  const hasReferenceScore =
    !referenceScoresGrouped &&
    player.axes.some((axis) => axis.sampleQuality === "reference" && axis.score !== null);
  const height = Math.ceil(radius * 2 + (hasReferenceScore ? 160 : 144));
  const presentation = dataVizSeriesPresentation(player.memberId);
  const vertices = axes.map((axis, index) => {
    const cell =
      axis.id === "achievement" && achievement
        ? {
            score: achievement.score,
            sampleQuality: "standard" as const,
            scoreUnavailableReasons: achievement.score === null ? (["no_target"] as const) : [],
          }
        : player.axes.find((value) => value.axisId === axis.id);
    return {
      axis,
      cell,
      point:
        cell?.score !== null && cell?.score !== undefined
          ? coordinate(center, index, (radius * cell.score) / 10, axes.length)
          : null,
    };
  });
  const beforeVertices = axes.map((axis, index) => {
    const cell = comparison?.before?.axes.find((value) => value.axisId === axis.id);
    return {
      axis,
      cell,
      point:
        cell?.score != null
          ? coordinate(center, index, (radius * cell.score) / 10, axes.length)
          : null,
    };
  });
  const areaPoints = vertices.map(({ point }) => point);
  return (
    <figure
      ref={figureRef}
      className="grid w-full min-w-0 gap-2"
      aria-labelledby={`${figureId}-name`}
    >
      <figcaption className={cn(contentText.body, "grid gap-1")} id={`${figureId}-name`}>
        <MemberSequenceLabel memberId={player.memberId}>{player.displayName}</MemberSequenceLabel>
        {comparison ? <span className={contentText.supporting}>■ 適用中　● 変更案</span> : null}
      </figcaption>
      <svg
        aria-describedby={`${figureId}-description`}
        aria-labelledby={`${figureId}-title`}
        className="block w-full"
        height={height}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <title id={`${figureId}-title`}>
          {player.displayName}の{axes.length}軸レーダー{comparison ? "（適用中／変更案）" : ""}
        </title>
        <desc id={`${figureId}-description`}>
          {referenceScoresGrouped ? "成績6軸の点数は参考値です。" : ""}
          {vertices
            .map(({ axis, cell }, index) => {
              const beforeLabel = playerRadarScoreLabel(beforeVertices[index]?.cell);
              const afterLabel = playerRadarScoreLabel(cell);
              return `${axis.label}：${comparison && beforeLabel !== afterLabel ? `適用中 ${beforeLabel}、変更案 ` : ""}${afterLabel}${!referenceScoresGrouped && cell?.sampleQuality === "reference" && cell.score !== null ? "（参考値）" : ""}`;
            })
            .join("。")}
        </desc>
        {areaPoints.every((point) => point !== null) ? (
          <polygon
            aria-hidden="true"
            fill={presentation.color}
            fillOpacity="0.08"
            points={areaPoints.map((point) => `${point.x},${point.y}`).join(" ")}
          />
        ) : null}
        <g aria-hidden="true" fill="none" stroke="var(--color-border)">
          {ticks.map((tick) => (
            <polygon
              key={tick}
              points={axes
                .map((_, index) => {
                  const point = coordinate(center, index, (radius * tick) / 10, axes.length);
                  return `${point.x},${point.y}`;
                })
                .join(" ")}
            />
          ))}
          {axes.map((axis, index) => {
            const edge = coordinate(center, index, radius, axes.length);
            return <line key={axis.id} x1={center.x} x2={edge.x} y1={center.y} y2={edge.y} />;
          })}
        </g>
        <g
          aria-hidden="true"
          fill="var(--color-text-secondary)"
          fontSize="12"
          className="tabular-nums"
        >
          {[0, ...ticks].map((tick) => (
            <text key={tick} x={center.x + 4} y={center.y - (radius * tick) / 10 + 5}>
              {tick}
            </text>
          ))}
        </g>
        <g aria-hidden="true" fill="var(--color-text-secondary)" fontSize="12">
          {vertices.map(({ axis, cell }, index) => {
            const before = beforeVertices[index]?.cell;
            const beforeLabel = playerRadarScoreLabel(before);
            const afterLabel = playerRadarScoreLabel(cell);
            const label = coordinate(center, index, radius + 36, axes.length);
            const reference =
              !referenceScoresGrouped && cell?.sampleQuality === "reference" && cell.score !== null;
            const labelHeight = axis.chartLabel.length * 16 + (reference ? 36 : 20);
            const top = axes.length === 6 && index === 3 ? label.y - 24 : label.y - labelHeight / 2;
            return (
              <g key={axis.id} textAnchor="middle">
                <text x={label.x} y={top + 12}>
                  {axis.chartLabel.map((line, lineIndex) => (
                    <tspan key={line} dy={lineIndex === 0 ? 0 : 16} x={label.x}>
                      {line}
                    </tspan>
                  ))}
                </text>
                <text
                  className={cn(
                    cell?.score !== null && cell?.score !== undefined
                      ? contentText.compactPrimary
                      : contentText.body,
                    "tabular-nums",
                  )}
                  fill="currentColor"
                  x={label.x}
                  y={top + axis.chartLabel.length * 16 + 16}
                >
                  {comparison && beforeLabel !== afterLabel
                    ? `${before?.score ?? beforeLabel} → ${afterLabel}`
                    : afterLabel}
                  {reference ? (
                    <tspan
                      className={contentText.supporting}
                      dy="16"
                      fill="currentColor"
                      x={label.x}
                    >
                      参考
                    </tspan>
                  ) : null}
                </text>
              </g>
            );
          })}
        </g>
        {comparison ? (
          <g aria-hidden="true" stroke="var(--color-text-secondary)" strokeWidth="1.5">
            {beforeVertices.map(({ axis, cell, point }, index) => {
              const next = beforeVertices[(index + 1) % beforeVertices.length];
              return point ? (
                <g key={axis.id}>
                  {next?.point ? (
                    <line
                      strokeDasharray={
                        cell?.sampleQuality === "reference" ||
                        next.cell?.sampleQuality === "reference"
                          ? "4 4"
                          : undefined
                      }
                      x1={point.x}
                      x2={next.point.x}
                      y1={point.y}
                      y2={next.point.y}
                    />
                  ) : null}
                  <rect
                    x={point.x - 2.5}
                    y={point.y - 2.5}
                    width="5"
                    height="5"
                    fill={
                      cell?.sampleQuality === "reference"
                        ? "var(--color-surface)"
                        : "var(--color-text-secondary)"
                    }
                  />
                </g>
              ) : null;
            })}
          </g>
        ) : null}
        <g aria-hidden="true" stroke={presentation.color} strokeWidth="1.8">
          {vertices.map(({ axis, cell, point }, index) => {
            const next = vertices[(index + 1) % vertices.length];
            if (!point || !next?.point) return null;
            const reference =
              cell?.sampleQuality === "reference" || next.cell?.sampleQuality === "reference";
            return (
              <line
                data-radar-edge={axis.id}
                key={axis.id}
                strokeDasharray={reference ? "4 4" : undefined}
                x1={point.x}
                x2={next.point.x}
                y1={point.y}
                y2={next.point.y}
              />
            );
          })}
          {vertices.map(({ axis, cell, point }) =>
            point && cell ? (
              <circle
                data-radar-point={axis.id}
                data-radar-score={cell.score}
                fill={
                  cell.sampleQuality === "reference" ? "var(--color-surface)" : presentation.color
                }
                key={axis.id}
                cx={point.x}
                cy={point.y}
                r="2.5"
              />
            ) : null,
          )}
        </g>
      </svg>
    </figure>
  );
}
