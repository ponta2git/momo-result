import type { SeriesComparisonAggregate as Aggregate } from "@/shared/api/seriesAnalysisAggregateTypes";
import type { SeriesComparisonReviewV3 as Review } from "@/shared/api/seriesAnalysisReviewTypes";

type Playbook = Review["playbookByPlayer"][number];
type PlaybookCard = NonNullable<Playbook["primaryCard"]>;
type UnexpectedWin = Aggregate["rankAnalysis"]["unexpectedWinsByPlayer"][number];

export type SeriesAnalysisHistogram = Aggregate["histograms"]["assets"];
export type SeriesAnalysisMomentumRate = Aggregate["momentumSwitch"][number]["afterFourth"];
export type SeriesAnalysisMatchDigestRow = Aggregate["matchDigest"]["recent"][number];
export type SeriesAnalysisRankCandidate =
  Aggregate["rankAnalysis"]["rankSignalsByPlayer"][number]["candidates"][number];
export type SeriesAnalysisRankAnalysis = Aggregate["rankAnalysis"];
export type SeriesAnalysisUnexpectedWinEvidence = NonNullable<UnexpectedWin["latest"]>["evidence"];
export type SeriesAnalysisReviewEvidence = PlaybookCard["evidence"][number];
