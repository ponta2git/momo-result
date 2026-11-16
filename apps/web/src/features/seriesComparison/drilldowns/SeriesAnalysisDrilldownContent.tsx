import { SeriesAnalysisDrilldownLoading } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownLoading";
import { ExpectedRankGapEvidence } from "@/features/seriesComparison/drilldowns/SeriesAnalysisExpectedRankGapEvidence";
import { PlayOrderHistoryDrilldown } from "@/features/seriesComparison/drilldowns/SeriesAnalysisPlayOrderHistoryDrilldown";
import { RankHistoryDrilldown } from "@/features/seriesComparison/drilldowns/SeriesAnalysisRankHistoryDrilldown";
import { useSeriesAnalysisDrilldown } from "@/features/seriesComparison/drilldowns/useSeriesAnalysisDrilldown";
import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/model/seriesAnalysisViewTypes";
import type { SeriesAnalysisDrilldownV3, SeriesAnalysisQuery } from "@/shared/api/seriesAnalysis";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

export function SeriesAnalysisDrilldownContent({
  baseQuery,
  onArtifactExpired,
  onFocusMatch,
  selection,
}: {
  baseQuery: SeriesAnalysisQuery;
  onArtifactExpired: () => void;
  onFocusMatch?: ((matchId: string) => void) | undefined;
  selection: SeriesAnalysisDrilldownSelection;
}) {
  const resource = useSeriesAnalysisDrilldown({ baseQuery, onArtifactExpired, selection });

  if (resource.kind === "loading") return <SeriesAnalysisDrilldownLoading />;
  if (resource.kind === "failed") {
    return (
      <Notice
        action={
          <Button
            pending={resource.pending}
            pendingLabel="再読み込み中"
            size="sm"
            variant="secondary"
            onClick={resource.retry}
          >
            再読み込み
          </Button>
        }
        tone="danger"
        title="詳細を読み込めません"
      >
        <p>比較の詳細を取得できませんでした。</p>
      </Notice>
    );
  }
  return <DrilldownBody response={resource.data} onFocusMatch={onFocusMatch} />;
}

function DrilldownBody({
  onFocusMatch,
  response,
}: {
  onFocusMatch?: ((matchId: string) => void) | undefined;
  response: SeriesAnalysisDrilldownV3;
}) {
  const payload = response.payload;
  switch (payload.kind) {
    case "rank_average_history":
      return <RankHistoryDrilldown payload={payload} playerName={response.player.displayName} />;
    case "play_order_rank_history":
      return (
        <PlayOrderHistoryDrilldown payload={payload} playerName={response.player.displayName} />
      );
    case "expected_rank_gap_evidence":
      return (
        <ExpectedRankGapEvidence
          payload={payload}
          playerName={response.player.displayName}
          onFocusMatch={onFocusMatch}
        />
      );
  }
}
