import { Search } from "lucide-react";

import {
  formatDateTime,
  formatDecimal,
  formatManYen,
  formatPercent,
  intensityClassName,
  qualityLabel,
  timelineFlagLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisSection,
  MetricValue,
  playerName,
  TableCell,
  TableHead,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { Button } from "@/shared/ui/actions/Button";

export function FlowView({
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
      <AnalysisSection
        id="metric-match-digest"
        title="期間内の荒れ"
        description={`${response.matchDigest.totalCount}戦中 ${response.matchDigest.shownCount}戦を表示・非表示 ${response.matchDigest.hiddenCount}戦`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>試合</TableHead>
                <TableHead>日時</TableHead>
                <TableHead>勝者</TableHead>
                <TableHead>1-2位資産差</TableHead>
                <TableHead>銀次</TableHead>
                <TableHead>フラグ</TableHead>
                <TableHead>詳細</TableHead>
              </tr>
            </thead>
            <tbody>
              {response.matchDigest.recent.map((row) => (
                <tr className="border-t border-[var(--color-border)]" key={row.itemId}>
                  <TableCell>第{row.matchIndex}戦</TableCell>
                  <TableCell>{formatDateTime(row.playedAt)}</TableCell>
                  <TableCell>
                    {row.winnerMemberId ? playerName(response.players, row.winnerMemberId) : "—"}
                  </TableCell>
                  <TableCell>{formatManYen(row.assetGapFirstToSecond)}</TableCell>
                  <TableCell>{row.totalGinjiCount}回</TableCell>
                  <TableCell>
                    {row.flags.length === 0 ? "—" : row.flags.map(timelineFlagLabel).join(" / ")}
                  </TableCell>
                  <TableCell>
                    <Button
                      icon={<Search className="size-4" />}
                      size="sm"
                      variant="quiet"
                      onClick={() => onFocusMatch(row.matchId)}
                    >
                      見る
                    </Button>
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-unexpected-wins" title="記録外の一撃">
        <div className="grid gap-3 md:grid-cols-2">
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
              <p className="mt-2 text-sm">
                勝利 {entry.totalWinCount}戦 / 対象 {entry.unexpectedWinCount}戦
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
      <AnalysisSection id="metric-recent-form" title="直近と累積推移">
        <div className="grid gap-3 md:grid-cols-2">
          {response.recentRanks.map((entry) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={entry.memberId}
            >
              <div className="flex justify-between gap-2">
                <h3 className="font-semibold">{entry.displayName}</h3>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  直近 {entry.targetCount}/{entry.windowSize}戦
                </span>
              </div>
              <p className="mt-1 text-sm">
                平均 {formatDecimal(entry.averageRank)}位・入賞 {formatPercent(entry.podiumRate)}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {entry.rows.map((row) => (
                  <span
                    className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] text-sm font-semibold"
                    key={row.itemId}
                  >
                    {row.rank}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>系列</TableHead>
                <TableHead>プレーヤー</TableHead>
                <TableHead>試合</TableHead>
                <TableHead>日時</TableHead>
                <TableHead>値</TableHead>
              </tr>
            </thead>
            <tbody>
              {response.trends.map((series) =>
                series.points.map((point) => (
                  <tr className="border-t border-[var(--color-border)]" key={point.itemId}>
                    <TableCell>{series.kind}</TableCell>
                    <TableCell>{playerName(response.players, series.memberId)}</TableCell>
                    <TableCell>{point.index}</TableCell>
                    <TableCell>{formatDateTime(point.playedAt)}</TableCell>
                    <TableCell>{formatDecimal(point.value)}</TableCell>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-momentum-switch" title="順位の切り替え">
        <div className="grid gap-3 md:grid-cols-2">
          {response.momentumSwitch.map((entry) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={entry.memberId}
            >
              <h3 className="font-semibold">{entry.displayName}</h3>
              <dl className="mt-2 grid gap-2 text-sm">
                <MetricValue
                  label="下位後の入賞"
                  value={`${formatPercent(entry.afterLower.rate)} / ${entry.afterLower.signal}`}
                />
                <MetricValue
                  label="4位後の入賞"
                  value={`${formatPercent(entry.afterFourth.rate)} / ${entry.afterFourth.signal}`}
                />
                <MetricValue
                  label="入賞後の下位"
                  value={`${formatPercent(entry.afterPodium.rate)} / ${entry.afterPodium.signal}`}
                />
              </dl>
              <div className="mt-3 grid grid-cols-4 gap-1">
                {entry.cells.map((cell) => (
                  <div
                    className={`rounded-[var(--radius-xs)] px-1 py-2 text-center text-[11px] ${intensityClassName(cell.relativeIntensity)}`}
                    key={cell.itemId}
                  >
                    {cell.previousRank}→{cell.nextRank}
                    <br />
                    {formatPercent(cell.rate)}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-match-no" title="開催内の第n試合傾向">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>区分</TableHead>
                <TableHead>試合番号</TableHead>
                <TableHead>プレーヤー</TableHead>
                <TableHead>対象</TableHead>
                <TableHead>平均順位</TableHead>
                <TableHead>入賞</TableHead>
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
