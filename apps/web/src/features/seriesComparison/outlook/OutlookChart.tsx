import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  formatRational,
  projectOutlook,
  rationalToNumber,
} from "@/features/seriesComparison/model/outlook";
import type {
  CumulativePair,
  OutlookExamplePoint,
  RankDistribution,
} from "@/features/seriesComparison/model/outlook";
import { OutlookChartScrubber } from "@/features/seriesComparison/outlook/OutlookChartScrubber";
import { orderFixedMembers } from "@/shared/domain/members";
import {
  MemberSequenceLabel,
  memberSequencePresentation,
} from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { contentText } from "@/shared/ui/typography";

type Point = { h: number; averages: readonly [number, number] };
type HorizonSelection = { horizon: number; horizonText: string };

/** Each person's line responds to their own assumption on an unchanged rank scale. */
export const OutlookChart = memo(function OutlookChart({
  cumulative,
  distributions,
  names,
  memberIds,
  horizon,
  horizonText,
  range,
  horizonControl,
  onHorizonChange,
  marker,
  examplePoints,
  maxHorizon = 1000,
}: {
  cumulative: CumulativePair;
  distributions: readonly [RankDistribution, RankDistribution];
  names: readonly [string, string];
  memberIds: readonly [string, string];
  horizon: number;
  horizonText: string;
  range: 100 | 500 | 1000;
  horizonControl: ReactNode;
  onHorizonChange: (selection: HorizonSelection) => void;
  marker: { h: number; label: string } | null;
  examplePoints?: readonly OutlookExamplePoint[] | undefined;
  maxHorizon?: 100 | 1000;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const titleId = useId();
  const helpId = useId();
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const [focus, rival] = distributions;
  const points = useMemo<Point[]>(() => {
    if (examplePoints)
      return examplePoints.map((point) => ({
        h: point.games,
        averages: [point.focusAverage, point.rivalAverage],
      }));
    // Wider ranges retain extra detail near the current result without growing the path.
    const horizons = new Set(
      Array.from({ length: 101 }, (_, index) =>
        range === 100 ? index : Math.round(range * (index / 100) ** 2),
      ),
    );
    return [...horizons].map((h) => {
      const projected = projectOutlook(cumulative, focus, rival, h);
      return {
        h,
        averages: [
          rationalToNumber(projected.focusAverage),
          rationalToNumber(projected.rivalAverage),
        ],
      };
    });
  }, [cumulative, focus, rival, range, examplePoints]);
  const current = projectOutlook(cumulative, focus, rival, 0);
  const projected = projectOutlook(cumulative, focus, rival, horizon);
  const exampleSelection = examplePoints?.find((point) => point.games === horizon);
  const selected: Point | null = examplePoints
    ? exampleSelection
      ? {
          h: horizon,
          averages: [exampleSelection.focusAverage, exampleSelection.rivalAverage],
        }
      : null
    : {
        h: horizon,
        averages: [
          rationalToNumber(projected.focusAverage),
          rationalToNumber(projected.rivalAverage),
        ],
      };
  const relation = examplePoints
    ? exampleSelection
      ? exampleSelection.gap > 0
        ? "ahead"
        : exampleSelection.gap < 0
          ? "behind"
          : "tied"
      : undefined
    : projected.relation;
  const relationLabel =
    relation === undefined
      ? "この展開例は100戦までです。"
      : `${horizon}戦後は${relation === "tied" ? "同率" : `${names[relation === "ahead" ? 0 : 1]}が上`}`;
  const people = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as 0 | 1 })),
  ).map((person, index) => ({
    memberId: person.memberId,
    role: person.role,
    color: memberSequencePresentation(person.memberId).color,
    dashed: index === 1,
  }));

  // Current ranks and all possible 1–4 future averages bound every editable curve.
  // Neither the selected horizon nor either person's distribution changes this scale.
  const bounds = [cumulative.focusRankSum, cumulative.rivalRankSum].flatMap((sum) => [
    sum / cumulative.games,
    (sum + range) / (cumulative.games + range),
    (sum + 4 * range) / (cumulative.games + range),
  ]);
  const low = Math.min(...bounds);
  const high = Math.max(...bounds);
  const padding = Math.max((high - low) * 0.08, 0.005);
  const min = Math.max(1, low - padding);
  const max = Math.min(4, high + padding);
  const left = 48;
  const right = width - 16;
  const top = 30;
  const bottom = 214;
  const height = 258;
  const x = (h: number) => left + (h / range) * (right - left);
  const y = (average: number) => top + ((average - min) / (max - min)) * (bottom - top);
  const path = (role: 0 | 1) =>
    points
      .filter((point) => point.h <= range)
      .map((point, index) => `${index ? "L" : "M"}${x(point.h)},${y(point.averages[role])}`)
      .join(" ");
  const marks = [min, (min + max) / 2, max];
  const tickDigits = max - min < 0.1 ? 3 : 2;
  const shownMarker = marker && marker.h >= 0 && marker.h <= range ? marker : null;
  const markerProjection = shownMarker
    ? projectOutlook(cumulative, focus, rival, shownMarker.h)
    : null;
  const markerAverages = markerProjection
    ? ([
        rationalToNumber(markerProjection.focusAverage),
        rationalToNumber(markerProjection.rivalAverage),
      ] as const)
    : null;
  const selectedAverages = examplePoints
    ? selected?.averages.map((value) =>
        value.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      )
    : [formatRational(projected.focusAverage, 2), formatRational(projected.rivalAverage, 2)];
  const roundedSame =
    relation !== undefined &&
    relation !== "tied" &&
    selectedAverages?.[0] === selectedAverages?.[1];

  return (
    <figure className="grid min-w-0 gap-3" aria-labelledby={titleId}>
      <figcaption className="grid gap-1" id={titleId}>
        <span className={contentText.heading}>総合平均順位の推移</span>
        <span className={contentText.supporting}>上の線が先行</span>
      </figcaption>
      {horizonControl}
      <DataTable
        caption={{ content: "現在と指定戦数後の総合平均順位", visibility: "screen-reader" }}
        density="compact"
        layout="fixed"
        rows={people}
        getRowKey={(person) => person.memberId}
        columns={[
          {
            key: "person",
            header: "プレーヤー",
            rowHeader: true,
            width: "40%",
            renderCell: (person) => (
              <span className="flex min-w-0 items-center gap-2">
                <svg width="24" height="12" className="shrink-0" aria-hidden="true">
                  <line
                    x1="0"
                    x2="24"
                    y1="6"
                    y2="6"
                    stroke={person.color}
                    strokeWidth="2.5"
                    strokeDasharray={person.dashed ? "5 3" : undefined}
                  />
                </svg>
                <MemberSequenceLabel memberId={person.memberId} accent={false}>
                  {names[person.role]}
                  <span className="sr-only">（{person.dashed ? "破線" : "実線"}）</span>
                </MemberSequenceLabel>
              </span>
            ),
          },
          {
            key: "current",
            header: "現在",
            align: "right",
            tabular: true,
            renderCell: (person) =>
              `${formatRational(person.role === 0 ? current.focusAverage : current.rivalAverage, 2)}位`,
          },
          {
            key: "selected",
            header: `${horizon}戦後`,
            align: "right",
            tabular: true,
            renderCell: (person) => (selectedAverages ? `${selectedAverages[person.role]}位` : "—"),
          },
        ]}
      />
      <div ref={root} className="relative min-w-0">
        <svg
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block w-full"
          role="img"
          aria-label={`この先${range}戦の2人の総合平均順位。確認する時点は${horizon}戦後${horizon > range ? "（グラフの範囲外）" : ""}。${relationLabel}${marker ? `。${marker.label}` : ""}`}
        >
          {marks.map((value) => (
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
          {[0, range / 5, range / 2, range].map((h) => (
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
            y={height - 3}
            textAnchor="middle"
            fontSize="12"
            fill="var(--color-text-secondary)"
          >
            この先の試合数（0は現在）
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
          {shownMarker && markerAverages ? (
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
                  cy={y(markerAverages[person.role])}
                  r={person.dashed ? 5 : 3}
                  fill={person.dashed ? "none" : person.color}
                  stroke={person.color}
                  strokeWidth="1.5"
                />
              ))}
              <text
                x={Math.max(left + 4, Math.min(right - 4, x(shownMarker.h)))}
                y={16}
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
          {selected && horizon <= range ? (
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
            horizon={horizon}
            horizonText={horizonText}
            range={range}
            maxHorizon={maxHorizon}
            onChange={onHorizonChange}
            descriptionId={helpId}
            valueText={`${horizon}戦後${horizon > range ? "（グラフの表示範囲外）" : ""}。${people
              .map(
                (person) =>
                  `${names[person.role]} ${selectedAverages?.[person.role] ?? "範囲外"}${selectedAverages ? "位" : ""}`,
              )
              .join("、")}。${relationLabel}`}
          />
        </div>
      </div>
      <p className={cn(contentText.body, "tabular-nums")}>
        {relationLabel}
        {horizon > range ? `（グラフは${range}戦まで）` : ""}
        {roundedSame ? (
          <span className={cn(contentText.supporting, "block")}>
            表示は同じ値ですが、丸める前の平均には差があります。
          </span>
        ) : null}
      </p>
      <p id={helpId} className={contentText.supporting}>
        タップ・横ドラッグ・矢印キーで戦数を選べます。
      </p>
    </figure>
  );
});
