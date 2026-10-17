import { useId } from "react";

import {
  radarCurveScale,
  radarScoringSteps,
} from "@/features/seriesAnalysisAdmin/radar/radarScoringCurve";
import { orderFixedMembers } from "@/shared/domain/members";
import {
  playerRadarAxes,
  playerRadarScoreLabel,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import type {
  PlayerRadarAxisId,
  PlayerRadarDisplay,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

const plot = { left: 30, right: 386, top: 22, bottom: 202 };
const scoreY = (score: number) => plot.bottom - ((score - 1) / 9) * (plot.bottom - plot.top);
const currentColor = "var(--color-text-secondary)";
const editedColor = "var(--color-action)";
const surfaceColor = "var(--color-surface)";

function tickLabel(value: number) {
  const magnitude = Math.abs(value);
  return new Intl.NumberFormat("ja-JP", {
    maximumSignificantDigits: 4,
    notation: magnitude >= 1e7 || (magnitude > 0 && magnitude < 0.001) ? "scientific" : "standard",
  }).format(value);
}

export function PlayerRadarScoringCurve({
  axisId,
  before,
  after,
}: {
  axisId: PlayerRadarAxisId;
  before: PlayerRadarDisplay | null;
  after: PlayerRadarDisplay;
}) {
  const id = useId();
  const axis = playerRadarAxes.find((entry) => entry.id === axisId);
  const unit = axisId === "averageRank" ? "位" : "万円";
  const current = before?.basis?.axes.find((entry) => entry.axisId === axisId)?.thresholds;
  const edited = after.basis?.axes.find((entry) => entry.axisId === axisId)?.thresholds;
  const players = orderFixedMembers(after.players).map((player, index) => ({
    memberId: player.memberId,
    displayName: player.displayName,
    number: index + 1,
    before: before?.players
      .find((entry) => entry.memberId === player.memberId)
      ?.axes.find((cell) => cell.axisId === axisId),
    after: player.axes.find((cell) => cell.axisId === axisId),
  }));
  const series = [
    { name: "適用中", values: current, color: currentColor, dashed: true },
    { name: "変更案", values: edited, color: editedColor, dashed: false },
  ];
  const scale = radarCurveScale([
    ...(current?.map((value) => value.rawValue) ?? []),
    ...(edited?.map((value) => value.rawValue) ?? []),
    ...players.flatMap((player) =>
      [player.before?.rawValue, player.after?.rawValue].filter(
        (value): value is number => value != null,
      ),
    ),
  ]);
  const rawX = (value: number) => plot.left + scale.position(value) * (plot.right - plot.left);
  const height = 248 + players.length * 22;
  return (
    <figure aria-labelledby={`${id}-caption`} className="grid min-w-0 gap-2">
      <figcaption id={`${id}-caption`} className={contentText.heading}>
        {axis?.label}と点数の関係
      </figcaption>
      <p className={cn(contentText.supporting, readableTextWidthClass)}>
        横軸は{axis?.label}（{unit}）、縦軸は点数です。
        {axisId === "averageRank" ? "順位が小さいほど高得点。" : "金額が大きいほど高得点。"}
        境界と同じ値は高い方の点数になります。
      </p>
      <div className={cn(contentText.supporting, "flex flex-wrap gap-x-4 gap-y-1")}>
        {series.map((entry) => (
          <span key={entry.name} className="inline-flex items-center gap-2">
            <svg aria-hidden="true" width="24" height="12" viewBox="0 0 24 12">
              <path
                d="M0 6H24"
                stroke={entry.color}
                strokeWidth="2"
                strokeDasharray={entry.dashed ? "4 3" : undefined}
              />
            </svg>
            {entry.name}
            {entry.values ? "" : "（未適用）"}
          </span>
        ))}
      </div>
      <svg
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        viewBox={`0 0 400 ${height}`}
        className="block w-full max-w-lg tabular-nums"
      >
        <title id={`${id}-title`}>{axis?.label}の採点境界と選手の位置</title>
        <desc id={`${id}-description`}>
          {players
            .map(
              (player) =>
                `${player.number} ${player.displayName}: ${player.after?.rawValue == null ? "実値なし" : `${player.after.rawValue}${unit}`}、適用中 ${playerRadarScoreLabel(player.before)}、変更案 ${playerRadarScoreLabel(player.after)}`,
            )
            .join("。")}
          。番号から上へ伸びる線が各選手の実値です。点数がない選手は位置のみを示します。
        </desc>
        <g aria-hidden="true" fontSize="16" fill="var(--color-text-secondary)">
          {[1, 2, 4, 6, 8, 10].map((score) => (
            <g key={score}>
              <path
                d={`M${plot.left} ${scoreY(score)}H${plot.right}`}
                stroke="var(--color-border)"
              />
              <text x="20" y={scoreY(score) + 4} textAnchor="end">
                {score}
              </text>
            </g>
          ))}
          {scale.ticks.map((value, index) => (
            <text
              key={value}
              x={rawX(value)}
              y={plot.bottom + 21}
              textAnchor={
                index === 0 ? "start" : index === scale.ticks.length - 1 ? "end" : "middle"
              }
            >
              {tickLabel(value)}
            </text>
          ))}
          {series.map((entry) => {
            if (!entry.values?.length) return null;
            const steps = radarScoringSteps(
              axisId,
              entry.values.map((value) => value.rawValue),
            );
            const initialScore = axisId === "averageRank" ? 10 : 1;
            const path = `M${plot.left} ${scoreY(initialScore)}${steps.map((step) => `H${rawX(step.rawValue)}V${scoreY(step.to)}`).join("")}H${plot.right}`;
            return (
              <path
                key={entry.name}
                d={path}
                fill="none"
                stroke={entry.color}
                strokeWidth="2"
                strokeDasharray={entry.dashed ? "5 4" : undefined}
              />
            );
          })}
          {players.map((player, index) => {
            const raw = player.after?.rawValue;
            if (raw == null) return null;
            const x = rawX(raw);
            const laneY = 245 + index * 22;
            return (
              <g key={player.memberId}>
                <path
                  d={`M${x} ${plot.top}V${laneY - 9}`}
                  stroke="var(--color-text-muted)"
                  strokeDasharray="2 4"
                  opacity="0.5"
                />
                {player.before?.score != null && player.before.rawValue != null ? (
                  <circle
                    cx={rawX(player.before.rawValue)}
                    cy={scoreY(player.before.score)}
                    r="5"
                    fill={surfaceColor}
                    stroke={currentColor}
                    strokeWidth="2"
                  />
                ) : null}
                {player.after?.score == null ? null : (
                  <circle
                    cx={x}
                    cy={scoreY(player.after.score)}
                    r="4"
                    fill={editedColor}
                    stroke={surfaceColor}
                    strokeWidth="1"
                  />
                )}
                <circle
                  cx={x}
                  cy={laneY}
                  r="9"
                  fill={surfaceColor}
                  stroke="var(--color-text-secondary)"
                />
                <text x={x} y={laneY + 4} textAnchor="middle">
                  {player.number}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <ul className={cn(contentText.supporting, "flex list-none flex-wrap gap-x-4 gap-y-1 p-0")}>
        {players.map((player) => (
          <li key={player.memberId}>
            {player.number} {player.displayName}
            {player.after?.rawValue == null ? "（実値なし）" : ""}
          </li>
        ))}
      </ul>
    </figure>
  );
}
