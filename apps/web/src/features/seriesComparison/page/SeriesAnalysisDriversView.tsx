import { memo } from "react";

import {
  AssetComparisonCards,
  StrategyProfileQuadrant,
} from "@/features/seriesComparison/charts/SeriesAnalysisAssetCards";
import {
  AssetRevenueHistograms,
  StrategyScatter,
} from "@/features/seriesComparison/charts/SeriesAnalysisDriverCharts";
import {
  memberNames,
  playerName,
  formatHighlightValue,
  highlightMetricLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import {
  rankSignalCandidateShareLabel,
  rankSignalLabel,
} from "@/features/seriesComparison/model/seriesAnalysisRankPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/model/seriesAnalysisViewTypes";
import {
  DestinationOutcomeSection,
  RevenueOutcomeSection,
} from "@/features/seriesComparison/page/SeriesAnalysisOutcomeSections";
import {
  AnalysisReadingGuide,
  AnalysisSection,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { contentText } from "@/shared/ui/typography";

export const DriversView = memo(function DriversView({
  focusedItemIds,
  response,
  onDrilldown,
}: AnalysisViewProps) {
  return (
    <div
      aria-labelledby={analysisTabId("drivers")}
      className="grid gap-8"
      id={analysisPanelId("drivers")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="drivers" />
      <AnalysisSection id="metric-money" title="資産の残し方">
        <div className="grid gap-6">
          <AssetComparisonCards
            assetStyleProfiles={response.assetStyleProfiles}
            performanceProfiles={response.performanceProfiles}
            metricsByPlayer={response.metricsByPlayer}
            highlights={response.highlights}
          />
          <AssetRevenueHistograms players={response.players} histograms={response.histograms} />
          <div className="grid gap-2">
            <h3 className={contentText.heading}>資産タイプの位置</h3>
            <StrategyProfileQuadrant
              players={response.players}
              profile={response.performanceProfiles}
            />
          </div>
        </div>
      </AnalysisSection>
      <RevenueOutcomeSection focusedItemIds={focusedItemIds} response={response} />
      <DestinationOutcomeSection response={response} />
      <AnalysisSection id="metric-strategy-scatter" title="試合ごとの資産と収益">
        <div className="grid gap-4">
          <StrategyScatter
            focusedItemIds={focusedItemIds}
            players={response.players}
            points={response.strategyScatter.points}
          />
          <FactList
            ariaLabel="指標ごとの4人内最高"
            columns={4}
            items={response.highlights.map((highlight) => ({
              id: highlight.highlightId,
              label: highlightMetricLabel(highlight.metricId),
              value: (
                <span className="grid">
                  <span>{memberNames(response.players, highlight.leaderMemberIds)}</span>
                  <span className={contentText.compactPrimary}>
                    {formatHighlightValue(highlight.metricId, highlight.value)}
                  </span>
                </span>
              ),
            }))}
            layout="plain"
          />
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-rank-signals" title="順位を読む追加の手掛かり">
        <div className="grid gap-4">
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
            {response.rankAnalysis.rankSignalsByPlayer.map((entry) => (
              <article className="grid min-w-0 content-start gap-2" key={entry.memberId}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className={contentText.heading}>
                    <MemberSequenceLabel memberId={entry.memberId}>
                      {playerName(response.players, entry.memberId)}
                    </MemberSequenceLabel>
                  </h3>
                  <SeriesAnalysisQualityAdvisory status={entry.status} />
                </div>
                {entry.candidates.length === 0 ? (
                  <p className={contentText.body}>この範囲では、繰り返し残る候補はありません。</p>
                ) : (
                  <ul className="grid gap-2">
                    {entry.candidates.map((candidate) => (
                      <li className="grid gap-1" key={candidate.signal}>
                        <span className={contentText.compactPrimary}>
                          {rankSignalLabel(candidate.signal)}
                        </span>
                        <span className={cn(contentText.supporting, "tabular-nums")}>
                          {rankSignalCandidateShareLabel(
                            candidate.candidateSharePercent,
                            entry.candidates.length,
                          )}
                          ・別開催で支持 {candidate.supportCount}組
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div>
                  <Button
                    disabled={entry.candidates.length === 0}
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      onDrilldown({
                        memberId: entry.memberId,
                        metricId: "rankAnalysis.rankSignals",
                      })
                    }
                  >
                    検証範囲を見る
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <AnalysisReadingGuide
            ariaLabel="順位を読む追加の手掛かりの読み方"
            items={[
              {
                id: "decision",
                label: "候補の選び方",
                value: "候補内の比重と、別開催でも残った支持数を一緒に比べる",
              },
              {
                id: "next",
                label: "次に見る",
                value: "気になる候補の「検証範囲を見る」から、開催別の残り方と根拠試合を確かめる",
              },
              {
                id: "not-for",
                label: "使わない場面",
                value: "候補内の比重を、次戦の順位確率としては使わない",
              },
            ]}
          />
        </div>
      </AnalysisSection>
    </div>
  );
});
