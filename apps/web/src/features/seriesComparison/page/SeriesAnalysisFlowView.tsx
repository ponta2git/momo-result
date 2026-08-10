import {
  CumulativeFormCharts,
  MomentumMatrices,
} from "@/features/seriesComparison/charts/SeriesAnalysisFlowCharts";
import { MatchDigestStrip } from "@/features/seriesComparison/charts/SeriesAnalysisMatchDigest";
import { MatchNoInEventMatrix } from "@/features/seriesComparison/charts/SeriesAnalysisMatchNoMatrix";
import { RecentRankStrips } from "@/features/seriesComparison/charts/SeriesAnalysisRecentRankStrip";
import { qualityLabel } from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisSection,
  playerName,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { Button } from "@/shared/ui/actions/Button";

export function FlowView({
  focusedItemIds,
  response,
  onDrilldown,
  onFocusMatch,
}: AnalysisViewProps & { onFocusMatch: (matchId: string) => void }) {
  return (
    <div
      aria-labelledby={analysisTabId("flow")}
      className="grid gap-4"
      id={analysisPanelId("flow")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="flow" />
      <AnalysisSection
        description={`最近${response.matchDigest.shownCount}戦を表示しています。全${response.matchDigest.totalCount}戦のうち、それ以前の${response.matchDigest.hiddenCount}戦は累積推移に含まれます。`}
        id="metric-match-digest"
        title="最近の試合と荒れ方"
      >
        <MatchDigestStrip
          focusedItemIds={focusedItemIds}
          response={response}
          onFocusMatch={onFocusMatch}
        />
      </AnalysisSection>
      <AnalysisSection
        description="分析時点の事前予測より上位で終えた勝利です。再現可能な勝因とは限らないため、試合内容を確認します。"
        id="metric-unexpected-wins"
        title="予測より上位だった勝利"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {response.rankAnalysis.unexpectedWinsByPlayer.map((entry) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={entry.memberId}
            >
              <div className="flex justify-between gap-2">
                <h3 className="font-semibold">{playerName(response.players, entry.memberId)}</h3>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {qualityLabel(entry.status)}
                </span>
              </div>
              <p className="mt-2 text-sm tabular-nums">
                全{entry.totalWinCount}勝のうち {entry.unexpectedWinCount}戦
              </p>
              <Button
                className="mt-3"
                disabled={!entry.hasDetails}
                size="sm"
                variant="secondary"
                onClick={() =>
                  onDrilldown({ memberId: entry.memberId, metricId: "rankAnalysis.unexpectedWins" })
                }
              >
                対象試合を見る
              </Button>
            </article>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection
        description="直近の順位列と、全試合を古い順に積み上げた平均順位・入賞率です。短期の偏りと長期の変化を分けて読みます。"
        id="metric-recent-form"
        title="直近と累積推移"
      >
        <RecentRankStrips focusedItemIds={focusedItemIds} response={response} />
        <div className="mt-6">
          <CumulativeFormCharts focusedItemIds={focusedItemIds} response={response} />
        </div>
      </AnalysisSection>
      <AnalysisSection
        description="前の試合の順位から次の順位へ移った件数と割合です。割合は同じ前順位を母数にしています。"
        id="metric-momentum-switch"
        title="順位の切り替わり"
      >
        <MomentumMatrices focusedItemIds={focusedItemIds} response={response} />
      </AnalysisSection>
      <AnalysisSection
        description="開催内の試合番号ごとに、平均順位と入賞率を比べます。追加戦は通常4戦と分けて表示します。"
        id="metric-match-no"
        title="開催内の第n試合傾向"
      >
        <MatchNoInEventMatrix response={response} />
      </AnalysisSection>
    </div>
  );
}
