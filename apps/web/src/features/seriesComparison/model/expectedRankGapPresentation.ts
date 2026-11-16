import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { formatManYen as formatStoredManYen } from "@/shared/lib/formatters";

export type ExpectedRankGap = SeriesComparisonAggregate["expectedRankGap"];
export type ExpectedRankGapItem = ExpectedRankGap["items"][number];
export type ExpectedRankGapLevel = ExpectedRankGapItem["levels"][number];
export type ExpectedRankGapSummary = ExpectedRankGapLevel["overall"];
export type ExpectedRankGapBackground = NonNullable<ExpectedRankGapItem["background"]>;
export type ExpectedRankGapSignal = NonNullable<ExpectedRankGapSummary["signal"]>;

const itemLabels = {
  card_shop: "カード売り場",
  plus_station: "プラス駅",
  card_station: "カード駅",
  minus_station: "マイナス駅",
  ginji: "スリの銀次",
} as const satisfies Record<ExpectedRankGapItem["item"], string>;

const variableLabels = {
  revenue_share: "物件収益のシェア",
  total_assets: "総資産",
  ...itemLabels,
} as const satisfies Record<ExpectedRankGapBackground["variables"][number], string>;

export function gapItemLabel(item: ExpectedRankGapItem["item"]): string {
  return itemLabels[item];
}

export function gapVariableLabel(variable: ExpectedRankGapBackground["variables"][number]): string {
  return variableLabels[variable];
}

/** The same inclusive range wording as the Worker-owned conclusion sentences. */
export function gapLevelLabel(level: Pick<ExpectedRankGapLevel, "minimumCount" | "maximumCount">) {
  const { minimumCount, maximumCount } = level;
  if (maximumCount === null) return `${minimumCount}回以上`;
  if (maximumCount === minimumCount) return `${maximumCount}回`;
  if (minimumCount === 0) return `${maximumCount}回以下`;
  return `${minimumCount}〜${maximumCount}回`;
}

const rankFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

export function formatGapRank(value: number | null): string {
  return value === null ? "—" : `${rankFormatter.format(value)}位`;
}

/** Signed rank difference; values that round to zero read as "±0.00". */
export function formatRankGap(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded > 0 ? "＋" : rounded < 0 ? "−" : "±";
  return `${sign}${rankFormatter.format(Math.abs(rounded))}位`;
}

export function gapDirection(value: number | null): "above" | "below" | null {
  if (value === null) return null;
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? "above" : rounded < 0 ? "below" : null;
}

export function gapDirectionLabel(value: number | null): string | null {
  const direction = gapDirection(value);
  return direction === "above" ? "見込みより上位" : direction === "below" ? "見込みより下位" : null;
}

/** Only the two reported words are shown; "chance" is read from the band, not a label. */
export function gapSignalLabel(signal: ExpectedRankGapSummary["signal"]): string | null {
  return signal === "trend" ? "傾向あり" : signal === "hint" ? "兆し" : null;
}

export function isReportedSignal(signal: ExpectedRankGapSummary["signal"]): boolean {
  return signal === "trend" || signal === "hint";
}

const AXIS_STEPS = [0.2, 0.4, 0.5, 1] as const;
const MAXIMUM_AXIS_TICKS = 7;
const MINIMUM_AXIS_SCALE = 0.4;
const MAXIMUM_AXIS_SCALE = 3;

export type GapAxis = { scale: number; ticks: number[] };

/**
 * One symmetric axis shared by the player table and every subject of the record table, so a
 * subject switch never rescales the rows. The step is the smallest round value that keeps the
 * axis at five to seven ticks. Reference rows (one or two results) may exceed it and are drawn up
 * to the edge; their exact value stays in the value column.
 */
export function gapAxis(gap: ExpectedRankGap): GapAxis {
  const summaries = [
    ...gap.players,
    ...gap.items.flatMap((item) =>
      item.levels.flatMap((level) => [level.overall, ...level.byPlayer]),
    ),
  ].filter((summary) => summary.quality === "ok");
  const largest =
    Math.max(
      0,
      ...summaries.flatMap((summary) => [Math.abs(summary.meanGap ?? 0), summary.band ?? 0]),
    ) * 1.05;
  for (const step of AXIS_STEPS) {
    const scale = Math.min(
      MAXIMUM_AXIS_SCALE,
      Math.max(MINIMUM_AXIS_SCALE, Math.ceil(largest / step - 1e-9) * step),
    );
    const count = Math.round(scale / step);
    if (count * 2 + 1 <= MAXIMUM_AXIS_TICKS || step === AXIS_STEPS.at(-1)) {
      return {
        scale: count * step,
        ticks: Array.from({ length: count * 2 + 1 }, (_, index) =>
          Number(((index - count) * step).toFixed(1)),
        ),
      };
    }
  }
  return { scale: MINIMUM_AXIS_SCALE, ticks: [-0.4, -0.2, 0, 0.2, 0.4] };
}

/** Position of a value on the axis as a percentage of the track width (0 = left edge). */
export function gapAxisPosition(value: number, scale: number): number {
  const clamped = Math.max(-scale, Math.min(scale, value));
  return 50 + (clamped / scale) * 50;
}

/** Tick labels stay unitless; the rank unit is read once from the value column. */
export function formatAxisTick(value: number): string {
  if (Math.abs(value) < 1e-9) return "0";
  return `${value > 0 ? "＋" : "−"}${Math.abs(value).toFixed(1)}`;
}

const percentFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 0,
  style: "percent",
});

export function formatGapShare(value: number): string {
  return percentFormatter.format(value);
}

const deltaFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const pointFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

function signed(value: number, digits: number, text: (magnitude: number) => string): string {
  const scale = 10 ** digits;
  const rounded = Math.round(value * scale) / scale;
  const sign = rounded > 0 ? "＋" : rounded < 0 ? "−" : "±";
  return `${sign}${text(Math.abs(rounded))}`;
}

/** Background values are differences from the same layer, never absolute levels. */
export function formatBackgroundValue(
  variable: ExpectedRankGapBackground["variables"][number],
  value: number,
): string {
  if (variable === "revenue_share") {
    return signed(value * 100, 1, (magnitude) => `${pointFormatter.format(magnitude)}ポイント`);
  }
  if (variable === "total_assets") {
    return signed(value, 0, (magnitude) => formatStoredManYen(magnitude));
  }
  return signed(value, 2, (magnitude) => `${deltaFormatter.format(magnitude)}回`);
}

export function backgroundValueUnit(
  variable: ExpectedRankGapBackground["variables"][number],
): string {
  if (variable === "revenue_share") return "平均の差";
  if (variable === "total_assets") return "中央値の差";
  return "1試合平均の差";
}

/**
 * A merged layer reads as one destination range, so the table itself shows which expectations
 * were computed from several destination counts.
 */
export function gapLayerLabel(layer: ExpectedRankGap["layers"][number]): string {
  return `収益${layer.revenueRank}位・${destinationRangeLabel(layer.destinationLevels)}`;
}

/** Destination levels are 0, 1, and 2 (two or more); merged layers hold adjacent levels. */
function destinationRangeLabel(levels: readonly number[]): string {
  const lowest = Math.min(...levels);
  const highest = Math.max(...levels);
  if (lowest === 0 && highest === 2) return "目的地の回数を問わない";
  if (highest === 2) return `目的地${lowest}回以上`;
  if (lowest === highest) return `目的地${lowest}回`;
  return `目的地${highest}回以下`;
}
