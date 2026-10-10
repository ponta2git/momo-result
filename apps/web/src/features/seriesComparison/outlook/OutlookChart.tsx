import { memo, useLayoutEffect, useId, useRef, useState } from "react";

import type { OutlookRelation } from "@/features/seriesComparison/model/outlook";
import { OutlookChartScrubber } from "@/features/seriesComparison/outlook/OutlookChartScrubber";
import { orderFixedMembers } from "@/shared/domain/members";
import { memberSequencePresentation } from "@/shared/matches/MemberSequenceLabel";
import { contentText } from "@/shared/ui/typography";

export type OutlookChartPoint = { h: number; averages: readonly [number, number] };
export type OutlookChartSelection = {
  averages: readonly [number, number];
  formatted: readonly [string, string];
  relation: OutlookRelation;
  gapText: string;
};
export type OutlookChartPattern = {
  id: string;
  label: string;
  points: readonly OutlookChartPoint[];
  selected: OutlookChartSelection;
};

/** Every pattern uses the same players, axes, and observation position. */
export const OutlookChart = memo(function OutlookChart({
  pattern,
  names,
  memberIds,
  horizon,
  horizonText,
  range,
  ticks,
  descriptionId,
  onHorizonChange,
  marker,
}: {
  pattern: OutlookChartPattern;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  horizon: number;
  horizonText: string;
  range: 50 | 100 | 200;
  ticks: readonly number[];
  descriptionId: string;
  onHorizonChange: (selection: { horizon: number; horizonText: string }) => void;
  marker?: { h: number; label: string; averages: readonly [number, number] } | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    setWidth(Math.max(1, Math.floor(element.getBoundingClientRect().width)));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const people = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as 0 | 1 })),
  ).map((person, index) => ({
    memberId: person.memberId,
    role: person.role,
    color: memberSequencePresentation(person.memberId).color,
    dashed: index === 1,
  }));
  const { selected } = pattern;
  const relationLabel =
    selected.relation === "tied" ? "同率" : `${names[selected.relation === "ahead" ? 0 : 1]}が上`;
  const min = ticks[0] ?? 1;
  const max = ticks.at(-1) ?? 4;
  const tickStep = (ticks[1] ?? max) - min;
  const tickDigits = Math.max(2, Math.min(4, Math.ceil(-Math.log10(tickStep))));
  const left = 56;
  const right = width - 16;
  const top = 26;
  const bottom = 190;
  const height = 230;
  const x = (h: number) => left + (h / range) * (right - left);
  const y = (average: number) => top + ((average - min) / (max - min)) * (bottom - top);
  const visible = pattern.points.filter((point) => point.h <= range);
  const path = (role: 0 | 1) =>
    visible
      .map((point, index) => `${index ? "L" : "M"}${x(point.h)},${y(point.averages[role])}`)
      .join(" ");
  const shownMarker = marker && marker.h <= range ? marker : null;

  return (
    <figure className="grid min-w-0 content-start gap-2" aria-labelledby={titleId}>
      <figcaption id={titleId} className={contentText.heading}>
        {pattern.label}
      </figcaption>
      <div ref={root} className="relative min-w-0">
        <svg
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block w-full"
          role="img"
          aria-label={`${pattern.label}。この先${range}戦の2人の総合平均順位。確認する時点は${horizon}戦後${horizon > range ? "（グラフの範囲外）" : ""}。${relationLabel}${marker ? `。${marker.label}` : ""}`}
        >
          {ticks.map((value) => (
            <g key={value}>
              <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--color-border)" />
              <text
                x={left - 7}
                y={y(value) + 4}
                textAnchor="end"
                fontSize="12"
                fill="var(--color-text-secondary)"
              >
                {value.toFixed(tickDigits)}
              </text>
            </g>
          ))}
          {[0, range / 2, range].map((h) => (
            <g key={h}>
              {h === horizon ? null : (
                <line
                  x1={x(h)}
                  x2={x(h)}
                  y1={top}
                  y2={bottom}
                  stroke="var(--color-border)"
                  strokeDasharray="2 4"
                />
              )}
              <text
                x={x(h)}
                y={bottom + 20}
                textAnchor="middle"
                fontSize="12"
                fill="var(--color-text-secondary)"
              >
                {h}
              </text>
            </g>
          ))}
          <text
            x={(left + right) / 2}
            y={height - 2}
            textAnchor="middle"
            fontSize="12"
            fill="var(--color-text-secondary)"
          >
            この先の試合数
          </text>
          {people.map((person) => (
            <path
              key={person.memberId}
              aria-label={`${names[person.role]}の総合平均順位（${person.dashed ? "破線" : "実線"}）`}
              d={path(person.role)}
              fill="none"
              stroke={person.color}
              strokeWidth="2.5"
              strokeDasharray={person.dashed ? "6 4" : undefined}
            />
          ))}
          {shownMarker ? (
            <g aria-label={shownMarker.label}>
              {shownMarker.h === horizon ? null : (
                <line
                  x1={x(shownMarker.h)}
                  x2={x(shownMarker.h)}
                  y1={top}
                  y2={bottom}
                  stroke="var(--color-text-secondary)"
                  strokeDasharray="3 3"
                />
              )}
              {people.map((person) => (
                <circle
                  key={person.memberId}
                  cx={x(shownMarker.h)}
                  cy={y(shownMarker.averages[person.role])}
                  r={person.dashed ? 5 : 3}
                  fill={person.dashed ? "none" : person.color}
                  stroke={person.color}
                  strokeWidth="1.5"
                />
              ))}
              <text
                x={Math.max(left + 4, Math.min(right - 4, x(shownMarker.h)))}
                y={14}
                textAnchor={
                  shownMarker.h < range / 4
                    ? "start"
                    : shownMarker.h > (range * 3) / 4
                      ? "end"
                      : "middle"
                }
                fontSize="12"
                fill="var(--color-text-primary)"
              >
                {shownMarker.h}戦後
              </text>
            </g>
          ) : null}
          {horizon <= range ? (
            <g aria-label={`${horizon}戦後の確認位置`}>
              <line
                x1={x(horizon)}
                x2={x(horizon)}
                y1={top}
                y2={bottom}
                stroke="var(--color-text-primary)"
              />
              {people.map((person) => (
                <circle
                  key={person.memberId}
                  aria-label={`${names[person.role]}の${horizon}戦後`}
                  cx={x(horizon)}
                  cy={y(selected.averages[person.role])}
                  r={person.dashed ? 5 : 3}
                  fill={person.dashed ? "none" : person.color}
                  stroke={person.color}
                  strokeWidth="1.5"
                />
              ))}
            </g>
          ) : null}
        </svg>
        <div
          className="absolute"
          style={{ left, right: width - right, top, bottom: height - bottom }}
        >
          <OutlookChartScrubber
            label={`${pattern.label}のグラフで確認する戦数`}
            horizon={horizon}
            horizonText={horizonText}
            range={range}
            onChange={onHorizonChange}
            descriptionId={descriptionId}
            valueText={`${horizon}戦後${horizon > range ? "（グラフの表示範囲外）" : ""}。${people.map((person) => `${names[person.role]} ${selected.formatted[person.role]}位`).join("、")}。${relationLabel}`}
          />
        </div>
      </div>
    </figure>
  );
});
