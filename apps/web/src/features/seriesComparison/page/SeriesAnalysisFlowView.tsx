import { Search } from "lucide-react";

import {
  CumulativeTrendCharts,
  MomentumMatrices,
  RecentRankStrips,
} from "@/features/seriesComparison/charts/SeriesAnalysisFlowCharts";
import {
  formatDateTime,
  formatDecimal,
  formatManYen,
  formatPercent,
  qualityLabel,
  timelineFlagLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisSection,
  playerName,
  TableCell,
  TableHead,
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>試合</TableHead>
                <TableHead>日時</TableHead>
                <TableHead>勝者</TableHead>
                <TableHead>1–2位資産差</TableHead>
                <TableHead>銀次</TableHead>
                <TableHead>特徴</TableHead>
                <TableHead>選択</TableHead>
              </tr>
            </thead>
            <tbody>
              {response.matchDigest.recent.map((row) => {
                const focused = focusedItemIds.includes(row.itemId);
                return (
                  <tr
                    className={`border-t border-[var(--color-border)] ${focused ? "bg-[var(--color-surface-selected)]" : ""}`}
                    data-focused-metric={focused ? "true" : undefined}
                    key={row.itemId}
                  >
                    <TableCell>
                      第{row.matchIndex}戦{focused ? "・この試合" : ""}
                    </TableCell>
                    <TableCell>{formatDateTime(row.playedAt)}</TableCell>
                    <TableCell>
                      {row.winnerMemberId ? playerName(response.players, row.winnerMemberId) : "—"}
                    </TableCell>
                    <TableCell>{formatManYen(row.assetGapFirstToSecond)}</TableCell>
                    <TableCell>{row.totalGinjiCount}回</TableCell>
                    <TableCell>
                      {row.flags.length === 0
                        ? "大きな特徴なし"
                        : row.flags.map(timelineFlagLabel).join(" / ")}
                    </TableCell>
                    <TableCell>
                      <Button
                        icon={<Search aria-hidden="true" className="size-4" />}
                        size="sm"
                        variant="quiet"
                        onClick={() => onFocusMatch(row.matchId)}
                      >
                        比較する
                      </Button>
                    </TableCell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
          <CumulativeTrendCharts focusedItemIds={focusedItemIds} response={response} />
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>区分</TableHead>
                <TableHead>試合番号</TableHead>
                <TableHead>プレーヤー</TableHead>
                <TableHead>対象</TableHead>
                <TableHead>平均順位</TableHead>
                <TableHead>入賞率</TableHead>
              </tr>
            </thead>
            <tbody>
              {response.matchNoInEvent.entries.map((entry) =>
                entry.players.map((player) => (
                  <tr
                    className="border-t border-[var(--color-border)]"
                    key={`${entry.matchNoInEvent}:${player.memberId}`}
                  >
                    <TableCell>{entry.category === "regular" ? "通常" : "追加"}</TableCell>
                    <TableCell>第{entry.matchNoInEvent}戦</TableCell>
                    <TableCell>{player.displayName}</TableCell>
                    <TableCell>{player.targetCount}戦</TableCell>
                    <TableCell>{formatDecimal(player.averageRank)}位</TableCell>
                    <TableCell>{formatPercent(player.podiumRate)}</TableCell>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </AnalysisSection>
    </div>
  );
}
