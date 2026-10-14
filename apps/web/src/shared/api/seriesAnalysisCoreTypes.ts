import type { components } from "@/shared/api/generated";
import type { SeriesComparisonAggregate as Aggregate } from "@/shared/api/seriesAnalysisAggregateTypes";

type Drilldown = components["schemas"]["SeriesAnalysisDrilldownResponse"];
type RankAverageDrilldown = Extract<
  Drilldown,
  { payload: { kind: "rank_average_history" } }
>["payload"];

export type DataQualityStatus = Aggregate["dataQuality"]["items"][number]["qualityStatus"];
export type RelativeIntensity = Aggregate["headToHead"]["entries"][number]["relativeIntensity"];
export type ChangeDirection = RankAverageDrilldown["eventRows"][number]["changeDirection"];
export type SeriesAnalysisScope = Aggregate["scope"];
export type SeriesAnalysisPlayer = Aggregate["players"][number];

export type SeriesAnalysisOptionsResponse = components["schemas"]["SeriesAnalysisOptionsResponse"];
export type SeriesAnalysisStatusResponse = components["schemas"]["SeriesAnalysisStatusResponse"];
