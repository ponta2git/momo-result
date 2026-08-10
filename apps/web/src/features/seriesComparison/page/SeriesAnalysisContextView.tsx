import {
  formatDecimal,
  formatManYen,
  formatPercent,
  intensityClassName,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisSection,
  MetricValue,
  TableCell,
  TableHead,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { Button } from "@/shared/ui/actions/Button";

export function ContextView({ response, onDrilldown }: AnalysisViewProps) {
  return (
    <div
      aria-labelledby={analysisTabId("context")}
      className="grid gap-4"
      id={analysisPanelId("context")}
      role="tabpanel"
    >
      <AnalysisSection id="metric-play-order" title="番手比較">
        <div className="grid gap-3 md:grid-cols-2">
          {response.playOrderComparison.map((entry) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={entry.memberId}
            >
              <div className="flex justify-between gap-2">
                <h3 className="font-semibold">{entry.displayName}</h3>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {entry.signal}・差 {formatDecimal(entry.spread)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-1">
                {entry.cells.map((cell) => (
                  <div
                    className={`rounded-[var(--radius-xs)] px-1 py-2 text-center text-xs ${intensityClassName(cell.relativeIntensity)}`}
                    key={cell.itemId}
                  >
                    <p>{cell.playOrder}番手</p>
                    <p className="font-semibold tabular-nums">
                      {formatDecimal(cell.rankAverage)}位
                    </p>
                    <p>{cell.targetCount}戦</p>
                  </div>
                ))}
              </div>
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() =>
                  onDrilldown({ memberId: entry.memberId, metricId: "playOrder.rankHistory" })
                }
              >
                番手別推移
              </Button>
            </article>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-card-shop-destination" title="カード売り場と目的地">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>プレーヤー</TableHead>
                <TableHead>条件</TableHead>
                <TableHead>対象</TableHead>
                <TableHead>該当率</TableHead>
                <TableHead>平均順位</TableHead>
                <TableHead>勝率</TableHead>
                <TableHead>入賞率</TableHead>
                <TableHead>平均資産</TableHead>
              </tr>
            </thead>
            <tbody>
              {response.cardShopDestination.map((entry) =>
                entry.quadrants.map((quadrant) => (
                  <tr className="border-t border-[var(--color-border)]" key={quadrant.itemId}>
                    <TableCell>{entry.displayName}</TableCell>
                    <TableCell>{cardShopKindLabel(quadrant.kind)}</TableCell>
                    <TableCell>{quadrant.targetCount}戦</TableCell>
                    <TableCell>{formatPercent(quadrant.rate)}</TableCell>
                    <TableCell>{formatDecimal(quadrant.averageRank)}位</TableCell>
                    <TableCell>{formatPercent(quadrant.winRate)}</TableCell>
                    <TableCell>{formatPercent(quadrant.podiumRate)}</TableCell>
                    <TableCell>{formatManYen(quadrant.averageAssets)}</TableCell>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-ginji" title="スリの銀次">
        <div className="grid gap-3 md:grid-cols-2">
          {response.metricsByPlayer.map((metric) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={metric.memberId}
            >
              <div className="flex justify-between gap-2">
                <h3 className="font-semibold">{metric.displayName}</h3>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  遭遇 {metric.ginji.encounterMatches}戦
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <MetricValue label="遭遇率" value={formatPercent(metric.ginji.encounterRate)} />
                <MetricValue label="合計" value={`${metric.ginji.count}回`} />
                <MetricValue
                  label="遭遇時平均順位"
                  value={`${formatDecimal(metric.ginji.resilienceRankAverage)}位`}
                />
                <MetricValue
                  label="遭遇時平均資産"
                  value={formatManYen(metric.ginji.resilienceAssetsAverage)}
                />
              </dl>
            </article>
          ))}
        </div>
      </AnalysisSection>
    </div>
  );
}

function cardShopKindLabel(kind: string): string {
  switch (kind) {
    case "destination_with_shop":
      return "目的地あり・売り場あり";
    case "destination_without_shop":
      return "目的地あり・売り場なし";
    case "no_destination_with_shop":
      return "目的地なし・売り場あり";
    case "no_destination_without_shop":
      return "目的地なし・売り場なし";
    default:
      return kind;
  }
}
