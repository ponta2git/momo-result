import type { components } from "@/shared/api/generated";

type Aggregate = components["schemas"]["SeriesAnalysisAggregateResponse"];
type Drilldown = components["schemas"]["SeriesAnalysisDrilldownResponse"];
type PlayOrderDrilldown = Extract<
  Drilldown,
  { payload: { kind: "play_order_rank_history" } }
>["payload"];
type RankAverageDrilldown = Extract<
  Drilldown,
  { payload: { kind: "rank_average_history" } }
>["payload"];

export type DataQualityStatus = Aggregate["dataQuality"]["items"][number]["qualityStatus"];
export type RelativeIntensity = Aggregate["headToHead"]["entries"][number]["relativeIntensity"];
export type ChangeDirection = RankAverageDrilldown["eventRows"][number]["changeDirection"];
export type SeriesAnalysisArtifactRef = Aggregate["artifact"];
export type SeriesAnalysisScope = Aggregate["scope"];
export type SeriesAnalysisPlayer = Aggregate["players"][number];
export type RankCell = PlayOrderDrilldown["rows"][number]["rankDistribution"][number];
export type SeriesAnalysisPlayerMetrics = Aggregate["metricsByPlayer"][number];

export type SeriesAnalysisOptionsResponse = components["schemas"]["SeriesAnalysisOptionsResponse"];
export type SeriesAnalysisStatusResponse = components["schemas"]["SeriesAnalysisStatusResponse"];
