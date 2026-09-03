import {
  assetEvidenceLabel,
  assetEvidenceToneLabel,
  assetShapeLabel,
  assetStyleLabel,
  assetTagLabel,
} from "@/features/seriesComparison/model/seriesAnalysisAssetPresentation";
import {
  formatDecimal,
  formatManYen,
  formatPercent,
  profileLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { DataVizQuadrantPlot } from "@/shared/ui/dataViz/QuadrantPlot";

export function AssetComparisonCards({ response }: { response: SeriesComparisonAggregateV3 }) {
  const revenueLeaders = response.highlights.find(
    (highlight) => highlight.metricId === "revenue.average",
  )?.leaderMemberIds;
  return (
    <div className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-4">
      {response.assetStyleProfiles.entries.map((entry) => {
        const performance = response.performanceProfiles.entries.find(
          (candidate) => candidate.memberId === entry.memberId,
        );
        const metrics = response.metricsByPlayer.find(
          (candidate) => candidate.memberId === entry.memberId,
        );
        return (
          <article
            className="flex h-full min-w-0 flex-col rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
            key={entry.memberId}
          >
            <div className="flex items-start justify-between gap-2 pb-2">
              <h3 className="font-semibold">
                <MemberSequenceLabel memberId={entry.memberId}>
                  {entry.displayName}
                </MemberSequenceLabel>
              </h3>
              <span className="grid justify-items-end gap-1 text-xs text-[var(--color-text-secondary)] tabular-nums">
                <span>{entry.targetCount}戦</span>
                <SeriesAnalysisQualityAdvisory status={entry.qualityStatus} />
              </span>
            </div>
            <section className="min-h-36 py-3">
              <h4 className="text-xs font-semibold text-[var(--color-text-secondary)]">
                総資産の出方
              </h4>
              <p className="mt-1 text-sm font-semibold">{assetStyleLabel(entry.primaryKind)}</p>
              {entry.secondaryKind ? (
                <p className="mt-1 text-xs font-semibold text-[var(--color-text-secondary)]">
                  補助傾向: {assetTagLabel(entry.secondaryKind)}
                </p>
              ) : null}
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                {assetShapeLabel(entry.shapeKind)}
              </p>
              {entry.tags.length > 0 ? (
                <ul
                  aria-label={`${entry.displayName}の資産傾向タグ`}
                  className="mt-2 flex flex-wrap gap-1"
                >
                  {entry.tags.map((tag) => (
                    <li
                      className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1 text-xs"
                      key={tag}
                    >
                      {assetTagLabel(tag)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
            <section className="min-h-20 py-3">
              <h4 className="text-xs font-semibold text-[var(--color-text-secondary)]">
                総資産に占める物件収益の割合
              </h4>
              <p className="mt-1 text-sm font-semibold">
                {profileLabel(performance?.strategyKind ?? null)}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)] tabular-nums">
                物件収益比率 {formatPercent(performance?.averageRevenueAssetRate)}
              </p>
            </section>
            <section className="min-h-40 py-3">
              <h4 className="text-xs font-semibold text-[var(--color-text-secondary)]">主要根拠</h4>
              <dl className="mt-2 grid gap-2">
                {entry.evidence.map((evidence) => (
                  <div
                    className={`grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-[var(--radius-xs)] border px-2 py-1 text-xs ${assetEvidenceToneClassName(evidence.tone)}`}
                    key={evidence.kind}
                  >
                    <dt className="font-semibold">{assetEvidenceToneLabel(evidence.tone)}</dt>
                    <dd className="text-[var(--color-text-secondary)]">
                      {assetEvidenceLabel(evidence.kind)}
                    </dd>
                    <dd className="font-semibold tabular-nums">{formatPercent(evidence.value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="py-3">
              <h4 className="text-xs font-semibold text-[var(--color-text-secondary)]">
                総資産レンジ
              </h4>
              <div className="mt-2 grid grid-cols-3 items-start gap-1">
                <AssetFact
                  label="低め"
                  subLabel="下位10%"
                  value={formatManYen(entry.metrics.p10Assets)}
                />
                <AssetFact
                  label="中央"
                  subLabel="中央値"
                  value={formatManYen(entry.metrics.medianAssets)}
                />
                <AssetFact
                  label="高め"
                  subLabel="上位10%"
                  value={formatManYen(entry.metrics.p90Assets)}
                />
              </div>
            </section>
            <section className="pt-3">
              <h4 className="text-xs font-semibold text-[var(--color-text-secondary)]">
                物件収益額
              </h4>
              <div className="mt-2 grid grid-cols-3 items-start gap-1">
                <AssetFact label="最高" value={formatManYen(metrics?.revenue.max)} />
                <AssetFact
                  badge={revenueLeaders?.includes(entry.memberId) ? "4人内最高" : undefined}
                  label="平均"
                  value={formatManYen(metrics?.revenue.average)}
                />
                <AssetFact label="中央" value={formatManYen(metrics?.revenue.median)} />
              </div>
            </section>
            <div className="mt-3">
              <Disclosure
                ariaLabel={`${entry.displayName}の資産傾向の詳しい根拠`}
                panelPadding="sm"
                presentation="inset"
                summary="詳しい根拠"
                triggerVariant="supporting"
              >
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <AssetDetailFact
                    label="資産の幅"
                    value={formatManYen(entry.metrics.p90P10Spread)}
                  />
                  <AssetDetailFact
                    label="目的地あり"
                    value={formatPercent(entry.metrics.destinationPositiveRate)}
                  />
                  <AssetDetailFact
                    label="1位"
                    value={`${entry.metrics.winCount}件・${formatPercent(entry.metrics.winRate)}`}
                  />
                  <AssetDetailFact
                    label="2位"
                    value={`${entry.metrics.secondCount}件・${formatPercent(entry.metrics.secondRate)}`}
                  />
                  <AssetDetailFact
                    label="下位率"
                    value={formatPercent(entry.metrics.lowerHalfRate)}
                  />
                  <AssetDetailFact
                    label="勝利時資産中央"
                    value={formatManYen(entry.metrics.winMedianAssets)}
                  />
                  <AssetDetailFact
                    label="勝利時の2位差中央"
                    value={formatManYen(entry.metrics.winMedianMargin)}
                  />
                  <AssetDetailFact
                    label="2位時の1位差中央"
                    value={formatManYen(entry.metrics.secondMedianGap)}
                  />
                  <AssetDetailFact
                    label="下位時の1位差中央"
                    value={formatManYen(entry.metrics.lowerHalfMedianGap)}
                  />
                  <AssetDetailFact label="大勝" value={`${entry.metrics.blowoutWinCount}件`} />
                  <AssetDetailFact
                    label="惜しい2位"
                    value={`${entry.metrics.nearMissSecondCount}件`}
                  />
                  <AssetDetailFact label="大敗" value={`${entry.metrics.heavyLossCount}件`} />
                </dl>
                <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                  判定境界: 大勝 {formatManYen(response.assetStyleProfiles.blowoutWinThreshold)}・
                  惜しい2位 {formatManYen(response.assetStyleProfiles.nearMissSecondThreshold)}
                  ・大敗 {formatManYen(response.assetStyleProfiles.heavyLossThreshold)}
                </p>
              </Disclosure>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AssetDetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-l-2 border-[var(--color-border)] px-2 py-1">
      <dt className="text-xs text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="mt-1 font-semibold break-words tabular-nums">{value}</dd>
    </div>
  );
}

export function StrategyProfileQuadrant({ response }: { response: SeriesComparisonAggregateV3 }) {
  return (
    <DataVizQuadrantPlot
      ariaLabel="物件収益比率と順位スコアの4象限"
      cornerLabels={{
        bottomLeft: "遊戯王型（カード重視）／下位",
        bottomRight: "桃鉄型（物件重視）／下位",
        topLeft: "遊戯王型（カード重視）／上位",
        topRight: "桃鉄型（物件重視）／上位",
      }}
      points={response.performanceProfiles.entries.map((entry) => ({
        label: `${entry.displayName}、物件収益比率${formatPercent(entry.averageRevenueAssetRate)}、順位スコア${formatDecimal(entry.averageRankScore)}`,
        seriesId: entry.memberId,
        x: entry.averageRevenueAssetRate,
        y: entry.averageRankScore,
      }))}
      seriesIdentity={response.players.map((player) => ({
        id: player.memberId,
        label: player.displayName,
      }))}
      xAxisLabel="物件収益÷総資産"
      xMidpoint={response.performanceProfiles.averageRevenueAssetRateMedian}
      yAxisLabel="順位スコア（高いほど上位）"
      yDomain={[1, 4]}
      yMidpoint={response.performanceProfiles.averageRankScoreMedian}
    />
  );
}

function AssetFact({
  badge,
  label,
  subLabel,
  value,
}: {
  badge?: string | undefined;
  label: string;
  subLabel?: string | undefined;
  value: string;
}) {
  return (
    <div className="min-w-0 border-l-2 border-[var(--color-border)] px-2 py-1 text-left">
      <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{label}</p>
      {subLabel ? <p className="text-xs text-[var(--color-text-muted)]">{subLabel}</p> : null}
      <p className="mt-1 text-xs font-semibold break-words tabular-nums">{value}</p>
      {badge ? (
        <span className="mt-1 inline-flex rounded-full border border-[var(--color-analysis-emphasis)]/45 bg-[var(--color-analysis-emphasis)]/10 px-2 py-1 text-xs font-semibold text-[var(--color-analysis-emphasis)]">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function assetEvidenceToneClassName(tone: "neutral" | "risk" | "strength"): string {
  switch (tone) {
    case "strength":
      return "border-[var(--color-analysis-positive)]/45 bg-[var(--color-analysis-positive)]/10";
    case "risk":
      return "border-[var(--color-analysis-negative)]/45 bg-[var(--color-analysis-negative)]/10";
    case "neutral":
      return "border-[var(--color-border)]";
  }
}
