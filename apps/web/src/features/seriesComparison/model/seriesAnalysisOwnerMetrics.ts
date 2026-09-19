import {
  formatDecimal,
  formatManYen,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";

export type OwnerComparison = Extract<
  SeriesComparisonAggregate,
  { ownerComparison: unknown }
>["ownerComparison"];
export type OwnerCell = OwnerComparison["rows"][number]["cells"][number];
type Metric = {
  label: string;
  value: (cell: OwnerCell) => string;
  detail?: (cell: OwnerCell) => string;
};

/** URL vocabulary and display formatting share this catalog; calculation stays in the artifact. */
export const ownerMetrics = {
  "rank.average": { label: "平均順位", value: (cell) => `${formatDecimal(cell.rank.average)}位` },
  "rank.distribution": { label: "順位分布", value: () => "順位分布" },
  "assets.average": { label: "平均総資産", value: (cell) => formatManYen(cell.assets.average) },
  "revenue.average": { label: "平均物件収益", value: (cell) => formatManYen(cell.revenue.average) },
  "destination.average": {
    label: "目的地到着回数（1試合平均）",
    value: (cell) => `${formatDecimal(cell.destination.average)}回/試合`,
    detail: (cell) => `合計${cell.destination.count}回`,
  },
  "ginji.encounterRate": {
    label: "銀次遭遇率",
    value: (cell) => formatPercent(cell.ginji.encounterRate),
    detail: (cell) => `遭遇${cell.ginji.encounterMatches}戦`,
  },
  "ginji.average": {
    label: "銀次遭遇回数（1試合平均）",
    value: (cell) => `${formatDecimal(cell.ginji.average)}回/試合`,
    detail: (cell) => `合計${cell.ginji.count}回`,
  },
} satisfies Record<string, Metric>;
export type OwnerMetricId = keyof typeof ownerMetrics;
export const defaultOwnerMetric: OwnerMetricId = "rank.average";
export function isOwnerMetricId(value: string | null | undefined): value is OwnerMetricId {
  return value !== undefined && value !== null && Object.hasOwn(ownerMetrics, value);
}
export const ownerMetricOptions = Object.entries(ownerMetrics).map(([value, metric]) => ({
  value,
  label: metric.label,
}));
export function ownerMetricPresentation(id: OwnerMetricId): Metric {
  return ownerMetrics[id];
}
