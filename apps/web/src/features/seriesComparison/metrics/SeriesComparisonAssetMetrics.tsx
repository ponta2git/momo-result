import { Coins } from "lucide-react";

import {
  HistogramChart,
  StrategyProfileChart,
  StrategyScatterPlot,
} from "@/features/seriesComparison/charts/SeriesComparisonCharts";
import { EmphasisRuleNote } from "@/features/seriesComparison/metrics/SeriesComparisonEmphasisRuleNote";
import {
  MetricRow,
  PlayerMetricGrid,
  StatusBadge,
} from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/metrics/SeriesComparisonMetricSection";
import {
  FactChip,
  FactGroup,
  IntegratedMetricPanel,
  MiniFact,
  OutcomeDetails,
} from "@/features/seriesComparison/metrics/SeriesComparisonSectionPrimitives";
import type {
  AssetStyleEvidenceItem,
  AssetStyleProfileEntry,
  PerformanceProfileEntry,
  PlayerMetrics,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import {
  assetStyleEvidence,
  assetStyleProfileMap,
  extremumEmphasis,
  formatMoney,
  formatPercent,
  formatSignedPercentPoint,
  metricsMap,
  numericExtrema,
  performanceProfileMap,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import {
  assetStyleKindLabel,
  assetStyleShapeLabel,
  assetStyleTagLabel,
  strategyKindLabel,
} from "@/features/seriesComparison/model/seriesComparisonViewModel";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

export function AssetDistributionMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  const assetStyleByMember = assetStyleProfileMap(response);
  const performanceProfileByMember = performanceProfileMap(response);
  const revenueExtrema = {
    average: numericExtrema(response, (metrics) => metrics.revenue.average),
    max: numericExtrema(response, (metrics) => metrics.revenue.max),
    median: numericExtrema(response, (metrics) => metrics.revenue.median),
  };
  return (
    <MetricSection
      description="総資産の広がりと稼ぎ方の比重から、各プレーヤーの勝ち方と負け幅を示します。"
      Icon={Coins}
      title="総資産と勝ち筋"
      id="metric-money"
    >
      <EmphasisRuleNote />
      <PlayerMetricGrid
        cardClassName="grid grid-rows-[auto_1fr]"
        contentClassName="h-full"
        minColumnWidthRem={18}
        metricsByMember={metricsByMember}
        players={players}
      >
        {(player, metrics) => (
          <AssetStyleRows
            metrics={metrics}
            performanceProfile={performanceProfileByMember.get(player.memberId)}
            profile={assetStyleByMember.get(player.memberId)}
            revenueExtrema={revenueExtrema}
            revenueAssetRateMedian={
              response.playerPerformanceProfiles.averageRevenueAssetRateMedian
            }
            thresholds={response.assetStyleProfiles}
          />
        )}
      </PlayerMetricGrid>
      <HistogramChart histogram={response.histograms.assets} players={players} />
      <IntegratedMetricPanel
        description="物件収益比率と順位スコアの関係から、桃鉄型（物件重視）と遊戯王型（カード重視）の傾向を示します。"
        title="稼ぎ方の比重の根拠"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] xl:items-start">
          <StrategyScatterPlot players={players} points={response.matchPlayerPoints ?? []} />
          <StrategyProfileChart players={players} profiles={response.playerPerformanceProfiles} />
        </div>
      </IntegratedMetricPanel>
      <IntegratedMetricPanel
        description="物件収益の分布幅から、一度の上振れか継続的な収益かを切り分けます。"
        title="物件収益分布"
      >
        <HistogramChart histogram={response.histograms.revenue} players={players} />
      </IntegratedMetricPanel>
      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
        高資産は全員の上位10%（{formatMoney(response.assetStyleProfiles.highAssetThreshold)}
        以上）、低資産は下位10%（{formatMoney(response.assetStyleProfiles.lowAssetThreshold)}
        以下）です。順位は保存済み順位を使います。
      </p>
    </MetricSection>
  );
}

function AssetStyleRows({
  metrics: playerMetrics,
  performanceProfile,
  profile,
  revenueExtrema,
  revenueAssetRateMedian,
  thresholds,
}: {
  metrics: PlayerMetrics | undefined;
  performanceProfile: PerformanceProfileEntry | undefined;
  profile: AssetStyleProfileEntry | undefined;
  revenueExtrema: {
    average: ReturnType<typeof numericExtrema>;
    max: ReturnType<typeof numericExtrema>;
    median: ReturnType<typeof numericExtrema>;
  };
  revenueAssetRateMedian: number | null | undefined;
  thresholds: SeriesComparisonResponse["assetStyleProfiles"];
}) {
  if (!profile) {
    return <p className="text-sm text-[var(--color-text-secondary)]">判定なし</p>;
  }
  const tags = profile.tags ?? [];
  const styleMetrics = profile.metrics;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="grid min-h-32 gap-2 border-b border-[var(--color-border)] pb-2">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              総資産の出方
            </p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-text-primary)]">
              {assetStyleKindLabel(profile.primaryKind)}
            </p>
          </div>
          <StatusBadge status={profile.status} />
        </div>
        <StrategyAxisSummary
          performanceProfile={performanceProfile}
          revenueAssetRateMedian={revenueAssetRateMedian}
        />
        <p className="min-h-10 text-xs leading-5 text-[var(--color-text-secondary)]">
          {assetStyleShapeLabel(profile.shapeKind)}
        </p>
        <TagStack tags={tags} />
      </div>
      <AssetEvidenceRows items={assetStyleEvidence(profile, thresholds)} />
      <AssetRangeSummary metrics={styleMetrics} />
      <RevenueAmountSummary metrics={playerMetrics} revenueExtrema={revenueExtrema} />
      <div className="mt-auto">
        <OutcomeDetails title="総資産レンジと差">
          <MetricRow label="最高額" value={formatMoney(playerMetrics?.assets.max)} />
          <MetricRow label="最低額" value={formatMoney(playerMetrics?.assets.min)} />
          <MetricRow label="平均値" value={formatMoney(playerMetrics?.assets.average)} />
          <MetricRow label="高め-低め" value={formatMoney(styleMetrics.p90P10Spread)} />
          <MetricRow label="勝利時資産" value={formatMoney(styleMetrics.winMedianAssets)} />
          <MetricRow label="勝利時の1位-2位差" value={formatMoney(styleMetrics.winMedianMargin)} />
          <MetricRow label="2位時の1位差" value={formatMoney(styleMetrics.secondMedianGap)} />
          <MetricRow label="下位時の1位差" value={formatMoney(styleMetrics.lowerHalfMedianGap)} />
        </OutcomeDetails>
      </div>
    </div>
  );
}

function TagStack({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return (
      <div className="flex min-h-12 items-start">
        <span className="rounded-[var(--radius-xs)] border border-dashed border-[var(--color-border)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
          特徴タグなし
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-h-12 flex-wrap content-start gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]"
        >
          {assetStyleTagLabel(tag)}
        </span>
      ))}
    </div>
  );
}

function AssetEvidenceRows({ items }: { items: AssetStyleEvidenceItem[] }) {
  return (
    <div className="grid min-h-36 gap-2">
      {items.map((item) => (
        <MetricRow
          emphasis={item.emphasis}
          key={item.key}
          help={item.help}
          label={item.label}
          value={item.value}
        />
      ))}
    </div>
  );
}

function AssetRangeSummary({ metrics }: { metrics: AssetStyleProfileEntry["metrics"] }) {
  return (
    <FactGroup title="総資産レンジ">
      <FactChip label="低め" subLabel="下位10%" value={formatMoney(metrics.p10Assets)} />
      <FactChip label="中央" subLabel="中央値" value={formatMoney(metrics.medianAssets)} />
      <FactChip label="高め" subLabel="上位10%" value={formatMoney(metrics.p90Assets)} />
    </FactGroup>
  );
}

function RevenueAmountSummary({
  metrics,
  revenueExtrema,
}: {
  metrics: PlayerMetrics | undefined;
  revenueExtrema: {
    average: ReturnType<typeof numericExtrema>;
    max: ReturnType<typeof numericExtrema>;
    median: ReturnType<typeof numericExtrema>;
  };
}) {
  return (
    <FactGroup title="物件収益額">
      <FactChip
        badge={extremumEmphasis(metrics?.revenue.max, revenueExtrema.max, "max", {
          kind: "leader",
          label: "4人内最高",
        })}
        label="最高"
        value={formatMoney(metrics?.revenue.max)}
      />
      <FactChip
        badge={extremumEmphasis(metrics?.revenue.average, revenueExtrema.average, "max", {
          kind: "leader",
          label: "4人内最高",
        })}
        label="平均"
        value={formatMoney(metrics?.revenue.average)}
      />
      <FactChip
        badge={extremumEmphasis(metrics?.revenue.median, revenueExtrema.median, "max", {
          kind: "leader",
          label: "4人内最高",
        })}
        label="中央"
        value={formatMoney(metrics?.revenue.median)}
      />
    </FactGroup>
  );
}

function StrategyAxisSummary({
  performanceProfile,
  revenueAssetRateMedian,
}: {
  performanceProfile: PerformanceProfileEntry | undefined;
  revenueAssetRateMedian: number | null | undefined;
}) {
  const rate = performanceProfile?.averageRevenueAssetRate;
  const rateDelta =
    typeof rate === "number" &&
    Number.isFinite(rate) &&
    typeof revenueAssetRateMedian === "number" &&
    Number.isFinite(revenueAssetRateMedian)
      ? rate - revenueAssetRateMedian
      : undefined;
  return (
    <div className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="text-[11px] font-medium text-[var(--color-text-secondary)]">稼ぎ方の比重</p>
        <p className="text-xs font-semibold text-[var(--color-text-primary)]">
          {strategyKindLabel(performanceProfile?.strategyKind)}
        </p>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <MiniFact label="物件収益比率" value={formatPercent(rate)} />
        <MiniFact label="4人中央値との差" value={formatSignedPercentPoint(rateDelta)} />
      </div>
    </div>
  );
}
