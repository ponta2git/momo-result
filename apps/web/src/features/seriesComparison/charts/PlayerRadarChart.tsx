import { useId, useLayoutEffect, useRef, useState } from "react";

import { dataVizSeriesPresentation } from "@/features/seriesComparison/charts/dataViz/seriesPresentation";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import {
  playerRadarAxes,
  playerRadarScoreLabel,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import type { PlayerRadarPlayer } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

const ticks = [2, 4, 6, 8, 10];

function coordinate(center: { x: number; y: number }, index: number, distance: number) {
  const angle = -Math.PI / 2 + (index * Math.PI) / 3;
  return {
    x: center.x + Math.cos(angle) * distance,
    y: center.y + Math.sin(angle) * distance,
  };
}

/** Geometry only: all values, scores, and sample judgements come from the saved result. */
export function PlayerRadarChart({
  player,
  referenceScoresGrouped,
}: {
  player: PlayerRadarPlayer;
  referenceScoresGrouped: boolean;
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
  const radius = Math.min(128, (width / 2 - 36) / Math.cos(Math.PI / 6) - 36);
  const center = { x: width / 2, y: radius + 70 };
  const hasReferenceScore =
    !referenceScoresGrouped &&
    player.axes.some((axis) => axis.sampleQuality === "reference" && axis.score !== null);
  const height = Math.ceil(radius * 2 + (hasReferenceScore ? 160 : 144));
  const presentation = dataVizSeriesPresentation(player.memberId);
  const vertices = playerRadarAxes.map((axis, index) => {
    const cell = player.axes.find((value) => value.axisId === axis.id);
    return {
      axis,
      cell,
      point:
        cell?.score !== null && cell?.score !== undefined
          ? coordinate(center, index, (radius * cell.score) / 10)
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
      <figcaption className={cn(contentText.body, "flex")} id={`${figureId}-name`}>
        <MemberSequenceLabel memberId={player.memberId}>{player.displayName}</MemberSequenceLabel>
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
        <title id={`${figureId}-title`}>{player.displayName}の6軸レーダー</title>
        <desc id={`${figureId}-description`}>
          {referenceScoresGrouped ? "点数は参考値です。" : ""}
          {vertices
            .map(
              ({ axis, cell }) =>
                `${axis.label}：${playerRadarScoreLabel(cell)}${!referenceScoresGrouped && cell?.sampleQuality === "reference" && cell.score !== null ? "（参考値）" : ""}`,
            )
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
              points={playerRadarAxes
                .map((_, index) => {
                  const point = coordinate(center, index, (radius * tick) / 10);
                  return `${point.x},${point.y}`;
                })
                .join(" ")}
            />
          ))}
          {playerRadarAxes.map((axis, index) => {
            const edge = coordinate(center, index, radius);
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
            const label = coordinate(center, index, radius + 36);
            const reference =
              !referenceScoresGrouped && cell?.sampleQuality === "reference" && cell.score !== null;
            const labelHeight = axis.chartLabel.length * 16 + (reference ? 36 : 20);
            const top = index === 3 ? label.y - 24 : label.y - labelHeight / 2;
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
                  {playerRadarScoreLabel(cell)}
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
