import { useId } from "react";

import { dataVizSeriesPresentation } from "@/features/seriesComparison/charts/dataViz/seriesPresentation";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";
import type { PlayerRadarPlayer } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

const center = { x: 120, y: 140 };
const radius = 80;
const ticks = [2, 4, 6, 8, 10];
const labelPositions = [
  { x: 120, y: 24, anchor: "middle" },
  { x: 236, y: 62, anchor: "end" },
  { x: 236, y: 221, anchor: "end" },
  { x: 120, y: 252, anchor: "middle" },
  { x: 4, y: 221, anchor: "start" },
  { x: 4, y: 62, anchor: "start" },
] as const;

function coordinate(index: number, score: number) {
  const angle = -Math.PI / 2 + (index * Math.PI) / 3;
  return {
    x: center.x + Math.cos(angle) * radius * (score / 10),
    y: center.y + Math.sin(angle) * radius * (score / 10),
  };
}

function polygonPoints(score: number) {
  return playerRadarAxes
    .map((_, index) => {
      const point = coordinate(index, score);
      return `${point.x},${point.y}`;
    })
    .join(" ");
}

/** Geometry only: all values, scores, and sample judgements come from the saved result. */
export function PlayerRadarChart({
  player,
  tableId,
}: {
  player: PlayerRadarPlayer;
  tableId: string;
}) {
  const figureId = useId();
  const presentation = dataVizSeriesPresentation(player.memberId);
  const vertices = playerRadarAxes.map((axis, index) => {
    const cell = player.axes.find((value) => value.axisId === axis.id);
    return {
      axis,
      cell,
      point:
        cell?.score !== null && cell?.score !== undefined ? coordinate(index, cell.score) : null,
    };
  });
  const plottedPoints = vertices.flatMap((vertex) => (vertex.point ? [vertex.point] : []));
  const complete = plottedPoints.length === playerRadarAxes.length;
  const reference = vertices.some((vertex) => vertex.cell?.sampleQuality === "reference");

  return (
    <figure className="grid min-w-0 gap-2" aria-labelledby={`${figureId}-name`}>
      <figcaption className={cn(contentText.heading, "text-center")} id={`${figureId}-name`}>
        <MemberSequenceLabel memberId={player.memberId}>{player.displayName}</MemberSequenceLabel>
      </figcaption>
      <svg
        aria-describedby={tableId}
        aria-labelledby={`${figureId}-title ${figureId}-description`}
        className="mx-auto block w-full max-w-80 overflow-visible"
        role="img"
        viewBox="0 0 240 280"
      >
        <title id={`${figureId}-title`}>{player.displayName}の6軸レーダー</title>
        <desc id={`${figureId}-description`}>
          外側ほど好成績です。点数は1〜10点、中心の0は目盛りです。
          {reference ? "白抜きの点と破線は参考値です。" : ""}
          {complete ? "" : "未採点の軸は線と面をつなぎません。"}
          各軸の点数と元の成績は数値比較表で確認できます。
        </desc>
        <g aria-hidden="true" fill="none" stroke="var(--color-border)">
          {ticks.map((tick) => (
            <polygon key={tick} points={polygonPoints(tick)} />
          ))}
          {playerRadarAxes.map((axis, index) => {
            const edge = coordinate(index, 10);
            return <line key={axis.id} x1={center.x} x2={edge.x} y1={center.y} y2={edge.y} />;
          })}
        </g>
        <g aria-hidden="true" fill="var(--color-text-muted)" fontSize="12" className="tabular-nums">
          {[0, ...ticks].map((tick) => (
            <text key={tick} x={center.x + 4} y={center.y - (radius * tick) / 10 + 5}>
              {tick}
            </text>
          ))}
        </g>
        <g aria-hidden="true" fill="var(--color-text-secondary)" fontSize="12">
          {playerRadarAxes.map((axis, index) => {
            const label = labelPositions[index];
            if (!label) return null;
            return (
              <text key={axis.id} textAnchor={label.anchor} x={label.x} y={label.y}>
                {axis.chartLabel.map((line, lineIndex) => (
                  <tspan key={line} dy={lineIndex === 0 ? 0 : 16} x={label.x}>
                    {line}
                  </tspan>
                ))}
              </text>
            );
          })}
        </g>
        {complete && !reference ? (
          <polygon
            aria-hidden="true"
            data-radar-area="complete"
            fill={presentation.color}
            fillOpacity="0.1"
            points={plottedPoints.map((point) => `${point.x},${point.y}`).join(" ")}
          />
        ) : null}
        <g aria-hidden="true" stroke={presentation.color} strokeWidth="2.5">
          {vertices.map(({ axis, point }, index) => {
            const next = vertices[(index + 1) % vertices.length]?.point;
            if (!point || !next) return null;
            return (
              <line
                data-radar-edge={axis.id}
                key={axis.id}
                strokeDasharray={reference ? "4 4" : undefined}
                x1={point.x}
                x2={next.x}
                y1={point.y}
                y2={next.y}
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
                r="3.5"
              />
            ) : null,
          )}
        </g>
      </svg>
    </figure>
  );
}
