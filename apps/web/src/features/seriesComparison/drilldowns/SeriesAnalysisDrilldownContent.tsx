import { SeriesAnalysisDrilldownLoading } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownLoading";
import { PlayOrderHistoryDrilldown } from "@/features/seriesComparison/drilldowns/SeriesAnalysisPlayOrderHistoryDrilldown";
import { RankHistoryDrilldown } from "@/features/seriesComparison/drilldowns/SeriesAnalysisRankHistoryDrilldown";
import { RankSignalDrilldown } from "@/features/seriesComparison/drilldowns/SeriesAnalysisRankSignalDrilldown";
import { useSeriesAnalysisDrilldown } from "@/features/seriesComparison/drilldowns/useSeriesAnalysisDrilldown";
import {
  formatDateTime,
  formatDecimal,
  formatManYen,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type {
  SeriesAnalysisDrilldownMetricId,
  SeriesAnalysisDrilldownV3,
  SeriesAnalysisQuery,
} from "@/shared/api/seriesAnalysis";
import { formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { Button } from "@/shared/ui/actions/Button";
import { DataTable } from "@/shared/ui/data/DataTable";
import { FactList } from "@/shared/ui/data/FactList";
import { Notice } from "@/shared/ui/feedback/Notice";

export type SeriesAnalysisDrilldownSelection = {
  memberId: string;
  metricId: SeriesAnalysisDrilldownMetricId;
};

export function SeriesAnalysisDrilldownContent({
  baseQuery,
  onArtifactExpired,
  selection,
}: {
  baseQuery: SeriesAnalysisQuery;
  onArtifactExpired: () => void;
  selection: SeriesAnalysisDrilldownSelection;
}) {
  const resource = useSeriesAnalysisDrilldown({ baseQuery, onArtifactExpired, selection });

  if (resource.kind === "loading") return <SeriesAnalysisDrilldownLoading />;
  if (resource.kind === "failed") {
    return (
      <Notice tone="danger" title="詳細を読み込めません">
        <p>比較の詳細を取得できませんでした。</p>
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={resource.retry}>
            再読み込み
          </Button>
        </div>
      </Notice>
    );
  }
  return <DrilldownBody response={resource.data} />;
}

function DrilldownBody({ response }: { response: SeriesAnalysisDrilldownV3 }) {
  const payload = response.payload;
  switch (payload.kind) {
    case "rank_average_history":
      return <RankHistoryDrilldown payload={payload} playerName={response.player.displayName} />;
    case "play_order_rank_history":
      return (
        <PlayOrderHistoryDrilldown payload={payload} playerName={response.player.displayName} />
      );
    case "rank_signals":
      return <RankSignalDrilldown payload={payload} />;
    case "unexpected_wins":
      return <UnexpectedWinsDrilldown payload={payload} />;
  }
}

export function UnexpectedWinsDrilldown({
  payload,
}: {
  payload: Extract<SeriesAnalysisDrilldownV3["payload"], { kind: "unexpected_wins" }>;
}) {
  const qualityAdvisory = qualityAdvisoryLabel(payload.summary.status);
  return (
    <div className="grid gap-4">
      <FactList
        ariaLabel="予測より上位だった勝利の要約"
        columns={4}
        items={[
          {
            id: "wins",
            label: "勝利",
            value: `${payload.summary.totalWinCount}戦`,
          },
          {
            id: "targets",
            label: "確認対象",
            value: `${payload.summary.unexpectedWinCount}戦`,
          },
          ...(qualityAdvisory
            ? [
                {
                  id: "quality",
                  label: payload.summary.status === "reference" ? "注意" : "状態",
                  value: <SeriesAnalysisQualityAdvisory status={payload.summary.status} />,
                },
              ]
            : []),
        ]}
        layout="segmented"
      />
      {payload.rows.length === 0 ? (
        <Notice tone="info" title="予測より上位だった勝利はありません">
          この比較範囲では、確認対象になった勝利はありません。
        </Notice>
      ) : (
        <DataTable
          caption={{ content: "予測より上位だった勝利の根拠" }}
          columns={[
            {
              tabular: true,
              header: "試合",
              key: "match",
              renderCell: (row) => (
                <SeriesAnalysisMatchLink
                  ariaLabel={`${formatSeriesMatchIndex(row.matchIndex)}の試合結果を見る`}
                  matchId={row.matchId}
                  presentation="text"
                >
                  {formatSeriesMatchIndex(row.matchIndex)}
                </SeriesAnalysisMatchLink>
              ),
              rowHeader: true,
            },
            {
              tabular: true,
              header: "日時",
              key: "played-at",
              renderCell: (row) => formatDateTime(row.playedAt),
            },
            {
              tabular: true,
              header: "期待順位",
              key: "expected-rank",
              renderCell: (row) => `${formatDecimal(row.expectedRank)}位`,
            },
            {
              tabular: true,
              header: "実順位",
              key: "actual-rank",
              renderCell: (row) => `${row.actualRank}位`,
            },
            {
              tabular: true,
              header: "物件収益",
              key: "revenue",
              renderCell: (row) => formatManYen(row.evidence.revenueManYen),
            },
            {
              tabular: true,
              header: "目的地",
              key: "destination",
              renderCell: (row) => `${row.evidence.destinationCount}回`,
            },
            {
              tabular: true,
              header: "プラス駅",
              key: "plus-station",
              renderCell: (row) => `${row.evidence.plusStationCount}回`,
            },
            {
              tabular: true,
              header: "マイナス駅",
              key: "minus-station",
              renderCell: (row) => `${row.evidence.minusStationCount}回`,
            },
            {
              tabular: true,
              header: "カード駅",
              key: "card-station",
              renderCell: (row) => `${row.evidence.cardStationCount}回`,
            },
            {
              tabular: true,
              header: "カード売り場",
              key: "card-shop",
              renderCell: (row) => `${row.evidence.cardShopCount}回`,
            },
            {
              tabular: true,
              header: "スリの銀次",
              key: "ginji",
              renderCell: (row) => `${row.evidence.ginjiCount}回`,
            },
          ]}
          density="compact"
          getRowKey={(row) => row.matchId}
          minWidth="68rem"
          rows={payload.rows}
        />
      )}
    </div>
  );
}
