import {
  BadgeDollarSign,
  BarChart3,
  Clock3,
  Coins,
  MapPinned,
  RefreshCw,
  ShieldAlert,
  Store,
  Swords,
  Trophy,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  AnalysisTabs,
  SectionJumpLinks,
  analysisPanelId,
  analysisTabId,
  analysisViewFor,
} from "@/features/seriesComparison/SeriesComparisonAnalysisNavigation";
import type { AnalysisViewChange } from "@/features/seriesComparison/SeriesComparisonAnalysisNavigation";
import {
  HeadToHeadMatrix,
  HistogramChart,
  LineChart,
  PlayOrderHeatmap,
  RankDistributionStackedBars,
  RevenueRankConversionHeatmap,
  StrategyProfileChart,
  StrategyScatterPlot,
} from "@/features/seriesComparison/SeriesComparisonCharts";
import {
  MomentumSwitchMetrics,
  RecentFormMetrics,
} from "@/features/seriesComparison/SeriesComparisonFlowMetrics";
import {
  EmphasisBadge,
  MetricRow,
  PlayerMetricGrid,
  StatusBadge,
  emphasisTextClass,
} from "@/features/seriesComparison/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/SeriesComparisonMetricSection";
import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import type {
  AssetStyleEvidenceItem,
  AssetStyleProfileEntry,
  CardShopDestinationEntry,
  CardShopDestinationQuadrant,
  MatchNoBreakdown,
  MetricEmphasis,
  PerformanceProfileEntry,
  Player,
  PlayerMetrics,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import {
  assetStyleEvidence,
  assetStyleProfileMap,
  cardShopDestinationDefinitions,
  cardShopQuadrantsByKind,
  extremumEmphasis,
  formatCountRate,
  formatDecimal,
  formatMoney,
  formatPercent,
  formatPlayOrderLabel,
  formatSigned,
  formatSignedPercentPoint,
  leaderSummary,
  metricsMap,
  numericExtrema,
  performanceProfileMap,
  playOrderHeatmapRows,
  playOrderColor,
  playerNameMap,
  rankDistributionBars,
  rankOutcomeColor,
  revenueRankConversionEntries,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import { ReviewViewContent } from "@/features/seriesComparison/SeriesComparisonReviewPanel";
import {
  defaultSeriesComparisonView,
  averageRankSpread,
  assetStyleKindLabel,
  assetStyleShapeLabel,
  assetStyleTagLabel,
  ginjiSummary,
  playOrderSignal,
  qualitySummary,
  strategyKindLabel,
  timelineFlagLabel,
} from "@/features/seriesComparison/seriesComparisonViewModel";
import type { SeriesComparisonViewId } from "@/features/seriesComparison/seriesComparisonViewModel";
import { useSeriesComparisonPageController } from "@/features/seriesComparison/useSeriesComparisonPageController";
import type {
  SeriesComparisonResponse,
  SeriesComparisonReviewResponse,
} from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

function PageSkeleton() {
  return (
    <PageFrame className="gap-5" width="wide">
      <Skeleton className="min-h-24 rounded-[var(--radius-md)]" />
      <Skeleton className="min-h-24 rounded-[var(--radius-md)]" />
      <ComparisonSkeleton />
    </PageFrame>
  );
}

function ComparisonSkeleton() {
  return (
    <>
      {["a", "b", "c", "d"].map((id) => (
        <Skeleton key={id} className="min-h-64 rounded-[var(--radius-md)]" />
      ))}
    </>
  );
}

function SummaryBand({ response }: { response: SeriesComparisonResponse }) {
  const leader = leaderSummary(response);
  const spread = averageRankSpread(response);
  const ginji = ginjiSummary(response);

  return (
    <section className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-4">
      <SummaryItem label="対戦回数" value={`${response.matchCount}戦`} />
      <SummaryItem
        label="首位社長"
        value={leader.name ?? "-"}
        subLabel={
          leader.averageRank === undefined
            ? "平均順位なし"
            : `平均順位 ${formatDecimal(leader.averageRank)}${
                leader.gapToSecond === undefined
                  ? ""
                  : `、2位との差 ${leader.gapToSecond.toFixed(2)}`
              }`
        }
      />
      <SummaryItem
        label="順位差"
        value={spread.label}
        subLabel={
          spread.spread === undefined
            ? "平均順位の比較材料不足"
            : `平均順位の最大差 ${spread.spread.toFixed(2)}`
        }
      />
      <SummaryItem
        label="銀次被害"
        tone={ginji.abnormalMatches > 0 ? "notice" : "neutral"}
        value={`${ginji.totalEncounters}回`}
        subLabel={`2回以上の試合 ${ginji.abnormalMatches}件`}
      />
    </section>
  );
}

function SummaryItem({
  label,
  subLabel,
  tone = "neutral",
  value,
}: {
  label: string;
  subLabel?: string;
  tone?: "neutral" | "notice";
  value: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[var(--radius-sm)] border p-3",
        tone === "notice"
          ? "border-[var(--color-review)]/45 bg-[var(--color-review)]/10"
          : "border-[var(--color-border)] bg-[var(--color-surface-subtle)]",
      )}
    >
      <p className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 text-xl font-semibold break-words text-[var(--color-text-primary)] sm:text-2xl">
        {value}
      </p>
      {subLabel ? (
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{subLabel}</p>
      ) : null}
    </div>
  );
}

function AnalysisViewContent({
  hasReviewError,
  onViewChange,
  response,
  review,
  reviewLoading,
  view,
}: {
  hasReviewError: boolean;
  onViewChange: AnalysisViewChange;
  response: SeriesComparisonResponse;
  review: SeriesComparisonReviewResponse | undefined;
  reviewLoading: boolean;
  view: SeriesComparisonViewId;
}) {
  switch (view) {
    case "review":
      return (
        <ReviewViewContent
          hasReviewError={hasReviewError}
          response={response}
          review={review}
          reviewLoading={reviewLoading}
          onViewChange={onViewChange}
        />
      );
    case "flow":
      return (
        <>
          <MatchDigestMetrics response={response} />
          <RecentFormMetrics response={response} />
          <MomentumSwitchMetrics response={response} />
          <MatchNoInEventMetrics response={response} />
        </>
      );
    case "drivers":
      return (
        <>
          <AssetDistributionMetrics response={response} />
          <RevenueOutcomeMetrics response={response} />
          <DestinationOutcomeMetrics response={response} />
        </>
      );
    case "context":
      return (
        <>
          <PlayOrderMetrics response={response} />
          <CardShopDestinationMetrics response={response} />
          <GinjiMetrics response={response} />
        </>
      );
  }
  return (
    <>
      <BasicMetrics response={response} />
      <HeadToHeadMetrics response={response} />
      <RateMetrics response={response} />
    </>
  );
}

function BasicMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="平均順位は小さいほど上位です。順位ごとの回数で、勝ち切りと下位落ちを見ます。"
      icon={<Trophy className="size-5" />}
      title="順位の地力"
      id="metric-basic"
    >
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">順位分布</h3>
        <RankDistributionStackedBars entries={rankDistributionBars(response)} players={players} />
      </div>
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow label="平均順位" value={formatDecimal(metrics?.rank.average)} />
            {(metrics?.rank.distribution ?? []).map((item) => (
              <MetricRow
                key={item.rank}
                label={`${item.rank}位`}
                value={`${item.count}回・${formatPercent(item.rate)}`}
              />
            ))}
          </>
        )}
      </PlayerMetricGrid>
      <LineChart
        ariaLabel="平均順位の推移グラフ"
        domain={[1, 4]}
        formatValue={(value) => `${value.toFixed(0)}位`}
        lowValueAtTop
        players={players}
        series={response.trends.rankCumulativeAverage ?? []}
        yTicks={[1, 2, 3, 4]}
      />
    </MetricSection>
  );
}

function MatchDigestMetrics({ response }: { response: SeriesComparisonResponse }) {
  return (
    <MetricSection
      description="選択中範囲の全試合から、接戦、大差、スリの銀次多発、物件収益トップ未勝利の発生数と該当試合を確認します。"
      icon={<ShieldAlert className="size-5" />}
      title="期間内の荒れ試合"
      id="metric-match-digest"
    >
      <MatchResultStrip response={response} />
    </MetricSection>
  );
}

function HeadToHeadMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  return (
    <MetricSection
      description="行の社長が列の社長より上位だった割合です。件数が少ない相性は参考です。"
      icon={<Swords className="size-5" />}
      title="直接対決"
      id="metric-head-to-head"
    >
      <HeadToHeadMatrix entries={response.headToHead.entries ?? []} players={players} />
    </MetricSection>
  );
}

function AssetDistributionMetrics({ response }: { response: SeriesComparisonResponse }) {
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
      description="総資産の分布、物件収益、カード寄りの動きから、どう勝ちに近づいたかを見ます。"
      icon={<Coins className="size-5" />}
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
        description="右ほど物件寄り、左ほどカードや物件収益以外の動きが目立つ社長です。"
        title="桃鉄型 / 遊戯王型の根拠"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] xl:items-start">
          <StrategyScatterPlot players={players} points={response.matchPlayerPoints ?? []} />
          <StrategyProfileChart players={players} profiles={response.playerPerformanceProfiles} />
        </div>
      </IntegratedMetricPanel>
      <IntegratedMetricPanel
        description="物件収益の上振れと普段の稼ぎ方を、最高・平均・中央の分布で比べます。"
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

function EmphasisRuleNote() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
      <span className="font-semibold text-[var(--color-text-primary)]">強調ルール</span>
      <span className="inline-flex items-center gap-1.5">
        <EmphasisBadge emphasis={{ kind: "strength", label: "強み" }} />
        勝ち筋を支える有利な根拠
      </span>
      <span className="inline-flex items-center gap-1.5">
        <EmphasisBadge emphasis={{ kind: "risk", label: "注意" }} />
        下振れや負け幅の根拠
      </span>
      <span className="inline-flex items-center gap-1.5">
        <EmphasisBadge emphasis={{ kind: "leader", label: "4人内最高" }} />
        同じ物件収益指標で4人中最高
      </span>
      <span className="inline-flex items-center gap-1.5">
        <EmphasisBadge emphasis={{ kind: "evidence", label: "根拠" }} />
        良し悪しではなく型を示す材料
      </span>
    </div>
  );
}

function IntegratedMetricPanel({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="grid w-full max-w-full min-w-0 gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        <p className="text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
          {description}
        </p>
      </div>
      {children}
    </div>
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
            <p className="text-[11px] font-medium text-[var(--color-text-secondary)]">総資産の型</p>
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

function FactGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="grid gap-1.5 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">{title}</p>
      <div className="grid grid-cols-3 gap-1.5">{children}</div>
    </div>
  );
}

function FactChip({
  badge,
  label,
  subLabel,
  value,
}: {
  badge?: MetricEmphasis | undefined;
  label: string;
  subLabel?: string;
  value: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-1.5 py-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <p className="min-w-0 text-[10px] leading-4 font-medium break-words text-[var(--color-text-secondary)]">
          {label}
        </p>
        {badge ? <EmphasisBadge emphasis={badge} /> : null}
      </div>
      {subLabel ? (
        <p className="min-w-0 text-[10px] leading-4 break-words text-[var(--color-text-muted)]">
          {subLabel}
        </p>
      ) : null}
      <p
        className={cn(
          "mt-0.5 break-words text-xs font-semibold leading-4 tabular-nums",
          emphasisTextClass(badge?.kind),
        )}
      >
        {value}
      </p>
    </div>
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
        <p className="text-[11px] font-medium text-[var(--color-text-secondary)]">物件/カード軸</p>
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

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-xs)] bg-[var(--color-surface)] px-1.5 py-1">
      <p className="min-w-0 text-[10px] leading-4 break-words text-[var(--color-text-secondary)]">
        {label}
      </p>
      <p className="min-w-0 text-[11px] leading-4 font-semibold break-words text-[var(--color-text-primary)] tabular-nums">
        {value}
      </p>
    </div>
  );
}

function RateMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="順位のブレ幅です。小さいほど同じ順位帯で安定しています。"
      icon={<BarChart3 className="size-5" />}
      title="安定性"
      id="metric-rate"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <MetricRow
            label="順位ブレ"
            help="平均順位からの標準偏差。小さいほど順位が安定しています。"
            value={formatDecimal(metrics?.stability.rankStandardDeviation)}
          />
        )}
      </PlayerMetricGrid>
      <LineChart
        ariaLabel="順位ブレの推移グラフ"
        formatValue={(value) => value.toFixed(2)}
        minYStep={0.25}
        players={players}
        series={response.trends.rankCumulativeStandardDeviation ?? []}
      />
    </MetricSection>
  );
}

function PlayOrderMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="1P〜4Pの番手別成績です。番手差が小さいほど、席順の影響が小さい状態です。"
      icon={<RefreshCw className="size-5" />}
      title="番手別成績"
      id="metric-play-order"
    >
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">番手別平均順位</h3>
        <PlayOrderHeatmap players={players} rows={playOrderHeatmapRows(response)} />
      </div>
      <PlayerMetricGrid minColumnWidthRem={17} metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => <PlayOrderSignalRows metrics={metrics} />}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

function PlayOrderSignalRows({ metrics }: { metrics: PlayerMetrics | undefined }) {
  const signal = playOrderSignal(metrics);
  if (!signal.best || !signal.worst) {
    return <p className="text-sm text-[var(--color-text-secondary)]">対象データなし</p>;
  }
  return (
    <>
      <MetricRow label="得意番手" value={<PlayOrderValue item={signal.best} />} />
      <MetricRow label="苦手番手" value={<PlayOrderValue item={signal.worst} />} />
      <MetricRow
        help="番手別平均順位の最大値 - 最小値。大きいほど番手で成績差が出ています。"
        label="番手差"
        value={formatDecimal(signal.spread)}
      />
    </>
  );
}

function PlayOrderValue({
  item,
}: {
  item: NonNullable<PlayerMetrics["playOrder"]["breakdown"]>[number];
}) {
  return (
    <span className="inline-flex flex-wrap justify-end gap-x-1.5 gap-y-0.5">
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden="true"
          className="size-2 rounded-full"
          style={{ backgroundColor: playOrderColor(item.playOrder) }}
        />
        {formatPlayOrderLabel(item.playOrder)}
      </span>
      <span className="font-medium text-[var(--color-text-secondary)]">
        平均順位 {formatDecimal(item.rankAverage)}、{item.matchCount}戦
      </span>
    </span>
  );
}

function CardShopDestinationMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const entries = response.cardShopDestination.entries ?? [];
  const entriesByMember = new Map(entries.map((entry) => [entry.memberId, entry]));
  return (
    <MetricSection
      description="目的地到着とカード売り場停車が、同じ試合にどう出ているかを見ます。行動順はDBにないため、売り場停車が寄り道か、資金・カード準備か、到着に効いたかは断定しません。"
      icon={<Store className="size-5" />}
      title="カード売り場と目的地"
      id="metric-card-shop-destination"
    >
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">4象限の構成</h3>
        <CardShopDestinationComposition entriesByMember={entriesByMember} players={players} />
      </div>
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">社長別の内訳</h3>
        <CardShopDestinationGuide />
        <PlayerMetricGrid
          minColumnWidthRem={18}
          metricsByMember={metricsMap(response)}
          players={players}
        >
          {(player) => (
            <CardShopDestinationPlayerMatrix entry={entriesByMember.get(player.memberId)} />
          )}
        </PlayerMetricGrid>
      </div>
    </MetricSection>
  );
}

function CardShopDestinationGuide() {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
      <span className="font-semibold text-[var(--color-text-primary)]">読み方:</span>{" "}
      各セルは「件数・割合」と平均順位だけを表示します。売り場ありで到着なしは資金・カード準備の候補です。到着なし・売り場なしにもカード駅や他行動は含まれます。
    </div>
  );
}

function CardShopDestinationComposition({
  entriesByMember,
  players,
}: {
  entriesByMember: Map<string, CardShopDestinationEntry>;
  players: Player[];
}) {
  if (players.length === 0) {
    return (
      <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
        対象データなし
      </p>
    );
  }
  return (
    <div className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <CardShopDestinationLegend />
      <div className="grid gap-2">
        {players.map((player) => (
          <CardShopDestinationStackedBar
            entry={entriesByMember.get(player.memberId)}
            key={player.memberId}
            player={player}
          />
        ))}
      </div>
    </div>
  );
}

function CardShopDestinationLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
      {cardShopDestinationDefinitions.map((definition) => (
        <span key={definition.kind} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ backgroundColor: definition.color }}
          />
          <span className="font-medium text-[var(--color-text-primary)]">{definition.label}</span>
        </span>
      ))}
    </div>
  );
}

function CardShopDestinationStackedBar({
  entry,
  player,
}: {
  entry: CardShopDestinationEntry | undefined;
  player: Player;
}) {
  const denominator = entry?.denominator ?? 0;
  const quadrantsByKind = cardShopQuadrantsByKind(entry);
  const label = cardShopDestinationDefinitions
    .map((definition) => {
      const quadrant = quadrantsByKind.get(definition.kind);
      return `${definition.label}${quadrant?.targetCount ?? 0}戦`;
    })
    .join("、");
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
      <div className="min-w-0 text-sm font-semibold text-[var(--color-text-primary)]">
        {player.displayName}
      </div>
      <div
        aria-label={`${player.displayName}: ${label}`}
        className="flex h-5 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--color-surface)]"
        role="img"
      >
        {denominator > 0 ? (
          cardShopDestinationDefinitions.map((definition) => {
            const quadrant = quadrantsByKind.get(definition.kind);
            const count = quadrant?.targetCount ?? 0;
            return count > 0 ? (
              <span
                aria-hidden="true"
                key={definition.kind}
                style={{
                  backgroundColor: definition.color,
                  flexBasis: `${((quadrant?.rate ?? 0) * 100).toFixed(4)}%`,
                  flexGrow: 0,
                  flexShrink: 0,
                }}
                title={`${definition.label}: ${count}戦`}
              />
            ) : null;
          })
        ) : (
          <span className="grid w-full place-items-center text-xs text-[var(--color-text-muted)]">
            対象なし
          </span>
        )}
      </div>
    </div>
  );
}

function CardShopDestinationPlayerMatrix({
  entry,
}: {
  entry: CardShopDestinationEntry | undefined;
}) {
  if (!entry) {
    return <p className="text-sm text-[var(--color-text-secondary)]">対象データなし</p>;
  }
  const quadrantsByKind = cardShopQuadrantsByKind(entry);
  return (
    <>
      <MetricRow
        help="カード売り場停車が1回以上ある試合の割合です。"
        label="売り場あり試合"
        value={formatCountRate({
          count: entry.cardShopMatchCount,
          rate: entry.cardShopRate,
          targetCount: entry.denominator,
        })}
      />
      <MetricRow
        help="カード売り場あり試合のうち、目的地到着がなかった試合の割合です。"
        label="売り場あり・到着なし"
        value={formatCountRate({
          count: entry.cardShopWithoutDestinationCount,
          rate: entry.cardShopWithoutDestinationRate,
          targetCount: entry.cardShopMatchCount,
        })}
      />
      <div className="grid grid-cols-1 overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] min-[34rem]:grid-cols-2">
        {cardShopDestinationDefinitions.map((definition, index) => (
          <CardShopDestinationCell
            definition={definition}
            index={index}
            key={definition.kind}
            quadrant={quadrantsByKind.get(definition.kind)}
          />
        ))}
      </div>
      <OutcomeDetails title="詳しい内訳">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-2 py-1 font-medium whitespace-nowrap">象限</th>
                <th className="px-2 py-1 text-right font-medium whitespace-nowrap">1位率</th>
                <th className="px-2 py-1 text-right font-medium whitespace-nowrap">入賞率</th>
                <th className="px-2 py-1 text-right font-medium whitespace-nowrap">平均総資産</th>
                <th className="px-2 py-1 text-right font-medium whitespace-nowrap">平均物件収益</th>
              </tr>
            </thead>
            <tbody>
              {cardShopDestinationDefinitions.map((definition) => {
                const quadrant = quadrantsByKind.get(definition.kind);
                return (
                  <tr key={definition.kind} className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1 whitespace-nowrap text-[var(--color-text-primary)]">
                      {definition.label}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap text-[var(--color-text-primary)] tabular-nums">
                      {formatPercent(quadrant?.winRate)}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap text-[var(--color-text-primary)] tabular-nums">
                      {formatPercent(quadrant?.podiumRate)}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap text-[var(--color-text-primary)] tabular-nums">
                      {formatMoney(quadrant?.averageAssets)}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap text-[var(--color-text-primary)] tabular-nums">
                      {formatMoney(quadrant?.averageRevenue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </OutcomeDetails>
    </>
  );
}

function CardShopDestinationCell({
  definition,
  index,
  quadrant,
}: {
  definition: (typeof cardShopDestinationDefinitions)[number];
  index: number;
  quadrant: CardShopDestinationQuadrant | undefined;
}) {
  return (
    <div
      className={cn(
        "grid min-h-20 gap-2 p-2",
        index > 0 ? "border-t border-[var(--color-border)]" : "",
        index === 1 ? "min-[34rem]:border-t-0" : "",
        index % 2 === 1 ? "min-[34rem]:border-l" : "",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: definition.color }}
          />
          <span className="text-xs leading-4 font-semibold text-pretty text-[var(--color-text-primary)]">
            {definition.label}
          </span>
        </span>
        <StatusBadge status={quadrant?.status} />
      </div>
      <div className="mt-auto grid gap-1">
        <p className="text-base font-semibold text-[var(--color-text-primary)] tabular-nums">
          {quadrant?.targetCount ?? 0}戦・{formatPercent(quadrant?.rate)}
        </p>
        <p className="text-[11px] text-[var(--color-text-secondary)]">
          平均順位{" "}
          <span className="text-[var(--color-text-primary)] tabular-nums">
            {formatDecimal(quadrant?.averageRank)}
          </span>
        </p>
      </div>
    </div>
  );
}

function GinjiMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="スリの銀次は1回でも総資産を動かす事故です。2回以上の試合は分けて見ます。"
      icon={<ShieldAlert className="size-5" />}
      title="スリの銀次"
      id="metric-ginji"
    >
      <PlayerMetricGrid minColumnWidthRem={17} metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow label="被害回数" value={`${metrics?.ginji.count ?? 0}回`} />
            <MetricRow
              label="被害試合"
              value={`${metrics?.ginji.encounterMatches ?? 0}戦・${formatPercent(metrics?.ginji.encounterRate)}`}
            />
            <MetricRow
              label="2回以上の試合"
              value={`${metrics?.ginji.multiEncounterMatchCount ?? 0}戦`}
            />
            <MetricRow label="1試合最多" value={`${metrics?.ginji.maxInSingleMatch ?? 0}回`} />
            <MetricRow
              label="被害試合の平均順位"
              value={formatDecimal(metrics?.ginji.resilienceRankAverage)}
            />
            <MetricRow
              label="被害試合の平均総資産"
              value={formatMoney(metrics?.ginji.resilienceAssetsAverage)}
            />
            <MetricRow
              label="被害試合の平均物件収益"
              value={formatMoney(metrics?.ginji.resilienceRevenueAverage)}
            />
          </>
        )}
      </PlayerMetricGrid>
      <LineChart
        ariaLabel="スリの銀次累計回数の推移グラフ"
        formatValue={(value) => `${value.toFixed(0)}回`}
        players={players}
        series={response.trends.ginjiCumulativeCount ?? []}
      />
    </MetricSection>
  );
}

type RankOutcome = PlayerMetrics["revenueOutcome"]["top"];

function RevenueOutcomeMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="物件収益トップの試合を勝ち切れたか、トップでなくても1位に届いたかを見ます。"
      icon={<BadgeDollarSign className="size-5" />}
      title="物件収益トップを勝ちにできたか"
      id="metric-revenue-outcome"
    >
      <PlayerMetricGrid minColumnWidthRem={17} metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow
              status={metrics?.revenueOutcome.top.status}
              help="その試合で物件収益が全員中トップだったとき、最終1位になった割合です。同値トップは全員をトップ扱いにします。"
              label="物件収益トップで1位"
              value={formatCountRate({
                count: metrics?.revenueOutcome.top.winCount,
                rate: metrics?.revenueOutcome.top.winRate,
                targetCount: metrics?.revenueOutcome.top.targetCount,
              })}
            />
            <MetricRow
              status={metrics?.revenueOutcome.top.status}
              label="物件収益トップで入賞"
              value={formatCountRate({
                count: metrics?.revenueOutcome.top.podiumCount,
                rate: metrics?.revenueOutcome.top.podiumRate,
                targetCount: metrics?.revenueOutcome.top.targetCount,
              })}
            />
            <MetricRow
              status={metrics?.revenueOutcome.top.status}
              label="物件収益トップで下位"
              value={formatCountRate({
                count: metrics?.revenueOutcome.top.lowerHalfCount,
                rate: metrics?.revenueOutcome.top.lowerHalfRate,
                targetCount: metrics?.revenueOutcome.top.targetCount,
              })}
            />
            <MetricRow
              help="物件収益トップではなかったのに最終1位だった試合数です。"
              label="物件収益トップ外で1位"
              value={`${metrics?.revenueOutcome.nonTopWinCount ?? 0}戦`}
            />
            <MetricRow
              help="物件収益順位が下位（平均順位方式で2.5より大きい）だった試合で、1・2位に入った割合です。"
              status={metrics?.revenueOutcome.lowRevenue.status}
              label="物件収益下位で入賞"
              value={formatCountRate({
                count: metrics?.revenueOutcome.lowRevenue.podiumCount,
                rate: metrics?.revenueOutcome.lowRevenue.podiumRate,
                targetCount: metrics?.revenueOutcome.lowRevenue.targetCount,
              })}
            />
            <RankOutcomeStrip
              label="物件収益トップ時の順位"
              outcome={metrics?.revenueOutcome.top}
              status={metrics?.revenueOutcome.top.status}
            />
            <OutcomeDetails title="詳しい内訳">
              <MetricRow
                help="各試合の「物件収益順位 - 最終順位」を平均。プラスなら、物件収益順位以上の最終順位を取っています。"
                label="物件収益順位との差"
                value={formatSigned(metrics?.nonRevenue.rankDelta)}
              />
              <MetricRow
                help="物件収益が全員中トップだった試合のうち、最終1位ではなかった割合です。"
                label="物件収益トップ未勝利"
                value={`${metrics?.nonRevenue.highRevenueNoWinCount ?? 0}/${metrics?.nonRevenue.highRevenueTopCount ?? 0}戦・${formatPercent(metrics?.nonRevenue.highRevenueNoWinRate)}`}
              />
            </OutcomeDetails>
          </>
        )}
      </PlayerMetricGrid>
      <IntegratedMetricPanel
        description="行は物件収益順位、列は最終順位です。同値の物件収益順位は平均順位方式の値として分けます。"
        title="物件収益順位から最終順位への転換"
      >
        <RevenueRankConversionHeatmap
          entries={revenueRankConversionEntries(response)}
          players={players}
        />
      </IntegratedMetricPanel>
    </MetricSection>
  );
}

function DestinationOutcomeMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="目的地に多く入った試合を勝ち切れたか、少ない試合でも上位に入れたかを見ます。事件簿に残っている目的地到着だけを数えます。"
      icon={<MapPinned className="size-5" />}
      title="目的地到着を勝ちにできたか"
      id="metric-destination-outcome"
    >
      <PlayerMetricGrid minColumnWidthRem={17} metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow
              status={metrics?.destinationOutcome.top.status}
              help="目的地回数が全員中最多だった試合で、最終1位になった割合です。全員0回の試合は最多扱いにしません。"
              label="目的地最多で1位"
              value={formatCountRate({
                count: metrics?.destinationOutcome.top.winCount,
                rate: metrics?.destinationOutcome.top.winRate,
                targetCount: metrics?.destinationOutcome.top.targetCount,
              })}
            />
            <MetricRow
              status={metrics?.destinationOutcome.top.status}
              label="目的地最多で入賞"
              value={formatCountRate({
                count: metrics?.destinationOutcome.top.podiumCount,
                rate: metrics?.destinationOutcome.top.podiumRate,
                targetCount: metrics?.destinationOutcome.top.targetCount,
              })}
            />
            <MetricRow
              status={metrics?.destinationOutcome.top.status}
              label="目的地最多で下位"
              value={formatCountRate({
                count: metrics?.destinationOutcome.top.lowerHalfCount,
                rate: metrics?.destinationOutcome.top.lowerHalfRate,
                targetCount: metrics?.destinationOutcome.top.targetCount,
              })}
            />
            <MetricRow
              help="目的地順位が下位（平均順位方式で2.5より大きい）だった試合で、1・2位に入った割合です。"
              status={metrics?.destinationOutcome.lowDestination.status}
              label="目的地少なめで入賞"
              value={formatCountRate({
                count: metrics?.destinationOutcome.lowDestination.podiumCount,
                rate: metrics?.destinationOutcome.lowDestination.podiumRate,
                targetCount: metrics?.destinationOutcome.lowDestination.targetCount,
              })}
            />
            <MetricRow
              help="目的地0回だった試合で、1・2位に入った割合です。"
              status={metrics?.destinationOutcome.zeroDestination.status}
              label="目的地0回で入賞"
              value={formatCountRate({
                count: metrics?.destinationOutcome.zeroDestination.podiumCount,
                rate: metrics?.destinationOutcome.zeroDestination.podiumRate,
                targetCount: metrics?.destinationOutcome.zeroDestination.targetCount,
              })}
            />
            <RankOutcomeStrip
              label="目的地最多時の順位"
              outcome={metrics?.destinationOutcome.top}
              status={metrics?.destinationOutcome.top.status}
            />
            <RankOutcomeStrip
              label="目的地0回時の順位"
              outcome={metrics?.destinationOutcome.zeroDestination}
              status={metrics?.destinationOutcome.zeroDestination.status}
            />
            <OutcomeDetails title="詳しい内訳">
              <MetricRow
                help="各試合の「目的地到着数順位 - 最終順位」を平均。プラスなら、目的地順位以上の最終順位を取っています。"
                label="目的地順位との差"
                value={formatSigned(metrics?.destination.conversionDelta)}
              />
              <MetricRow
                help="目的地到着数が上位の試合で得た順位点から、下位の試合で得た順位点を引いた値。順位点は「5 - 最終順位」です。"
                label="取れた日の成績差"
                value={formatSigned(metrics?.destination.dependenceScore)}
              />
            </OutcomeDetails>
          </>
        )}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

function RankOutcomeStrip({
  label,
  outcome,
  status,
}: {
  label: string;
  outcome: RankOutcome | undefined;
  status?: string | null | undefined;
}) {
  const targetCount = outcome?.targetCount ?? 0;
  const distribution = outcome?.rankDistribution ?? [];
  return (
    <div className="grid gap-1.5 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex min-w-0 items-center gap-1.5">
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>
          <StatusBadge status={status} />
        </div>
        <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
          {targetCount > 0 ? `${targetCount}戦` : "対象なし"}
        </span>
      </div>
      {targetCount > 0 ? (
        <div
          aria-label={`${label}: ${distribution
            .map((item) => `${item.rank}位${item.count}回`)
            .join("、")}`}
          className="flex h-3 overflow-hidden rounded-full bg-[var(--color-surface-subtle)]"
          role="img"
        >
          {distribution.map((item) =>
            item.count > 0 ? (
              <span
                key={item.rank}
                aria-hidden="true"
                className="min-w-1"
                style={{
                  backgroundColor: rankOutcomeColor(item.rank),
                  flexGrow: item.count,
                }}
              />
            ) : null,
          )}
        </div>
      ) : (
        <div className="h-3 rounded-full bg-[var(--color-surface-subtle)]" />
      )}
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-[var(--color-text-secondary)]">
        {distribution.map((item) => (
          <span key={item.rank} className="inline-flex items-center gap-1 tabular-nums">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: rankOutcomeColor(item.rank) }}
            />
            {item.rank}位 {item.count}回
          </span>
        ))}
      </div>
    </div>
  );
}

function OutcomeDetails({ children, title }: { children: ReactNode; title: string }) {
  return (
    <details className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--color-text-secondary)]">
        {title}
      </summary>
      <div className="mt-2 grid gap-2">{children}</div>
    </details>
  );
}

function MatchResultStrip({ response }: { response: SeriesComparisonResponse }) {
  const names = playerNameMap(response.players ?? []);
  const timeline = response.matchTimeline ?? [];
  const flagOrder = ["close_finish", "asset_blowout", "ginji_storm", "revenue_top_no_win"];
  const flagCounts = new Map(
    flagOrder.map((flag) => [
      flag,
      timeline.filter((point) => (point.flags ?? []).includes(flag)).length,
    ]),
  );
  const flaggedTimeline = timeline
    .filter((point) => (point.flags ?? []).length > 0)
    .toReversed()
    .slice(0, 8)
    .toReversed();
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {flagOrder.map((flag) => (
          <div
            key={flag}
            className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2.5 py-2"
          >
            <p className="text-xs text-[var(--color-text-secondary)]">{timelineFlagLabel(flag)}</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
              {flagCounts.get(flag) ?? 0}戦
            </p>
          </div>
        ))}
      </div>
      {flaggedTimeline.length === 0 ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
          荒れ試合はありません。
        </p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max gap-3">
            {flaggedTimeline.map((point) => (
              <article
                key={point.matchId}
                className="w-44 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {point.matchIndex}戦目
                    </p>
                    <p className="mt-0.5 text-sm font-semibold break-words text-[var(--color-text-primary)]">
                      {names.get(point.winnerMemberId ?? "") ?? "勝者不明"}
                    </p>
                  </div>
                  <StatusBadge status={point.status} />
                </div>
                <div className="mt-2 grid gap-1 text-xs text-[var(--color-text-secondary)]">
                  <div className="flex justify-between gap-2">
                    <span>1位-2位差</span>
                    <span className="text-[var(--color-text-primary)] tabular-nums">
                      {formatMoney(point.assetGapFirstToSecond)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>1位-4位差</span>
                    <span className="text-[var(--color-text-primary)] tabular-nums">
                      {formatMoney(point.assetGapFirstToLast)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>スリの銀次</span>
                    <span className="text-[var(--color-text-primary)] tabular-nums">
                      {point.totalGinjiCount}回
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(point.flags ?? []).map((flag) => (
                    <span
                      key={flag}
                      className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]"
                    >
                      {timelineFlagLabel(flag)}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {flaggedTimeline.length <
          timeline.filter((point) => (point.flags ?? []).length > 0).length ? (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              新しい荒れ試合から8件まで表示します。
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function MatchNoInEventMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const breakdown = response.matchNoInEventBreakdown ?? [];
  const breakdownByNo = new Map(breakdown.map((item) => [item.matchNoInEvent, item]));
  const primaryBreakdown: MatchNoBreakdown[] = [1, 2, 3, 4].map(
    (matchNoInEvent) => breakdownByNo.get(matchNoInEvent) ?? { matchNoInEvent, playerRows: [] },
  );
  const extraBreakdown = breakdown.filter((item) => item.matchNoInEvent > 4);
  return (
    <MetricSection
      description="選択中範囲の全開催を横断し、第1〜第4試合ごとの平均順位と入賞率を見ます。第5試合以降は折りたたみます。"
      icon={<Clock3 className="size-5" />}
      title="第n試合の傾向"
      id="metric-match-no"
    >
      <MatchNoTable breakdown={primaryBreakdown} players={players} />
      {extraBreakdown.length > 0 ? (
        <details className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
            第5試合以降を表示
          </summary>
          <div className="mt-3">
            <MatchNoTable breakdown={extraBreakdown} players={players} />
          </div>
        </details>
      ) : null}
    </MetricSection>
  );
}

function MatchNoTable({
  breakdown,
  players,
}: {
  breakdown: MatchNoBreakdown[];
  players: Player[];
}) {
  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="grid min-w-[42rem] gap-1"
        style={{
          gridTemplateColumns: `7rem repeat(${Math.max(1, players.length)}, minmax(8rem, 1fr))`,
        }}
      >
        <div aria-hidden="true" />
        {players.map((player, index) => (
          <div
            key={player.memberId}
            className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1.5 text-center text-xs font-semibold break-words text-[var(--color-text-primary)]"
            style={{ borderTopColor: playerColor(index), borderTopWidth: 3 }}
          >
            {player.displayName}
          </div>
        ))}
        {breakdown.map((item) => (
          <MatchNoRow key={item.matchNoInEvent} item={item} players={players} />
        ))}
      </div>
    </div>
  );
}

function MatchNoRow({ item, players }: { item: MatchNoBreakdown; players: Player[] }) {
  const rowsByMember = new Map((item.playerRows ?? []).map((row) => [row.memberId, row]));
  return (
    <>
      <div className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-3 text-sm font-semibold text-[var(--color-text-primary)]">
        第{item.matchNoInEvent}試合
      </div>
      {players.map((player) => {
        const row = rowsByMember.get(player.memberId);
        return (
          <div
            key={player.memberId}
            className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--color-text-secondary)]">
                {row?.targetCount ?? 0}戦
              </span>
              <StatusBadge status={row?.status} />
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
              平均 {formatDecimal(row?.averageRank)}
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-text-secondary)] tabular-nums">
              入賞 {formatPercent(row?.podiumRate)}
            </div>
          </div>
        );
      })}
    </>
  );
}

function DataQualityNotice({ response }: { response: SeriesComparisonResponse }) {
  const summary = qualitySummary(response);
  if (summary.referenceCount === 0 && summary.noTargetCount === 0) {
    return null;
  }
  return (
    <Notice tone="info" title="条件付き指標があります。">
      スリの銀次、物件収益トップ、目的地最多・0回、切り替え力は対象条件があります。該当試合がない項目は「対象なし」、少ない項目は「参考」です。
    </Notice>
  );
}

export function SeriesComparisonPage() {
  const controller = useSeriesComparisonPageController();

  if (controller.optionsLoading) {
    return <PageSkeleton />;
  }

  const seriesOptions = (controller.options?.series ?? []).map((series) => ({
    label: `${series.name} (${series.confirmedMatchCount}戦)`,
    value: series.gameTitleId,
  }));
  const seasonOptions = [
    { label: "全シーズン", value: "" },
    ...controller.seasonOptions.map((option) => ({
      label: option.name,
      value: option.id,
    })),
  ];
  const mapOptions = [
    { label: "全マップ", value: "" },
    ...controller.mapOptions.map((option) => ({
      label: option.name,
      value: option.id,
    })),
  ];

  return (
    <PageFrame className="gap-5" width="wide">
      <PageHeader
        actions={
          <Button
            disabled={!controller.canRefresh}
            icon={<RefreshCw className="size-4" />}
            pending={controller.aggregateRefreshing || controller.reviewRefreshing}
            pendingLabel="更新中"
            variant="secondary"
            onClick={controller.refresh}
          >
            更新
          </Button>
        }
        description="確定済みの試合から、順位、総資産、物件収益、目的地到着、スリの銀次を比べます。"
        eyebrow="分析"
        title="戦績比較"
      />

      {controller.hasOptionsError ? (
        <Notice tone="danger" title="対象作品を読み込めません">
          通信状態を確認して、再読み込みしてください。
        </Notice>
      ) : null}

      {seriesOptions.length === 0 && !controller.hasOptionsError ? (
        <EmptyState
          icon={<BarChart3 className="size-5" />}
          title="比較できる戦績がありません"
          description="確定済みの試合が揃うと比較できます。"
        />
      ) : seriesOptions.length > 0 ? (
        <>
          <section className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(12rem,1fr)] md:items-end">
            <div className="min-w-0 md:col-span-3">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">表示範囲</h2>
              <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
                シーズンとマップを同時に絞れます。対象作品の切り替えは過去作品を見るときに使います。
              </p>
            </div>
            <SelectField
              label="シーズン"
              options={seasonOptions}
              value={controller.state.seasonMasterId ?? ""}
              onChange={(event) => controller.updateSeasonMasterId(event.currentTarget.value)}
            />
            <SelectField
              label="マップ"
              options={mapOptions}
              value={controller.state.mapMasterId ?? ""}
              onChange={(event) => controller.updateMapMasterId(event.currentTarget.value)}
            />
            <SelectField
              label="対象作品"
              options={seriesOptions}
              value={controller.state.gameTitleId ?? ""}
              onChange={(event) => controller.updateGameTitle(event.currentTarget.value)}
            />
          </section>

          {controller.hasAggregateError ? (
            <Notice tone="danger" title="戦績データを読み込めません">
              条件を変えるか、時間をおいて再読み込みしてください。
            </Notice>
          ) : controller.aggregateLoading ? (
            <ComparisonSkeleton />
          ) : controller.aggregate && controller.aggregate.matchCount === 0 ? (
            <EmptyState
              icon={<BarChart3 className="size-5" />}
              title="この範囲に確定済みの試合がありません"
              description="総合、別シーズン、別マップを選ぶと表示できる場合があります。"
            />
          ) : controller.aggregate ? (
            <SeriesComparisonContent controller={controller} />
          ) : null}
        </>
      ) : null}
    </PageFrame>
  );
}

function SeriesComparisonContent({
  controller,
}: {
  controller: ReturnType<typeof useSeriesComparisonPageController>;
}) {
  if (!controller.aggregate) {
    return null;
  }
  const activeView = controller.state.view ?? defaultSeriesComparisonView;
  const activeDefinition = analysisViewFor(activeView);
  return (
    <>
      <div className="text-sm text-[var(--color-text-secondary)]">
        {controller.selectedSeries?.name}・{controller.scopeName}
      </div>
      <SummaryBand response={controller.aggregate} />
      <AnalysisTabs activeView={activeView} onViewChange={controller.updateView} />
      <DataQualityNotice response={controller.aggregate} />
      <div
        aria-labelledby={analysisTabId(activeDefinition.id)}
        id={analysisPanelId(activeDefinition.id)}
        role="tabpanel"
      >
        <div className="grid gap-4" id={`analysis-${activeDefinition.id}`}>
          <SectionJumpLinks items={activeDefinition.sections} />
          <AnalysisViewContent
            hasReviewError={controller.hasReviewError}
            response={controller.aggregate}
            review={controller.review}
            reviewLoading={controller.reviewLoading}
            view={activeDefinition.id}
            onViewChange={controller.updateView}
          />
        </div>
      </div>
    </>
  );
}
