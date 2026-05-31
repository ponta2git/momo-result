import {
  BadgeDollarSign,
  BarChart3,
  Coins,
  MapPinned,
  RefreshCw,
  ShieldAlert,
  Trophy,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  HistogramChart,
  LineChart,
  playerGridStyle,
} from "@/features/seriesComparison/SeriesComparisonCharts";
import {
  averageRankSpread,
  ginjiSummary,
  qualitySummary,
} from "@/features/seriesComparison/seriesComparisonViewModel";
import { useSeriesComparisonPageController } from "@/features/seriesComparison/useSeriesComparisonPageController";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { formatManYen } from "@/shared/lib/formatters";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type Player = NonNullable<SeriesComparisonResponse["players"]>[number];
type MetricsEntry = NonNullable<SeriesComparisonResponse["metricsByPlayer"]>[number];
type PlayerMetrics = MetricsEntry["metrics"];

function formatDecimal(value: number | undefined, digits = 2): string {
  return value === undefined ? "-" : value.toFixed(digits);
}

function formatSigned(value: number | undefined, unit = ""): string {
  if (value === undefined) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${unit}`;
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

function formatMoney(value: number | undefined): string {
  return value === undefined ? "-" : formatManYen(Math.round(value));
}

function metricsMap(response: SeriesComparisonResponse): Map<string, PlayerMetrics> {
  return new Map((response.metricsByPlayer ?? []).map((entry) => [entry.memberId, entry.metrics]));
}

function MetricSection({
  children,
  description,
  icon,
  title,
}: {
  children: ReactNode;
  description?: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <div
          aria-hidden="true"
          className="rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] p-2 text-[var(--color-action)]"
        >
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function PlayerMetricGrid({
  children,
  metricsByMember,
  players,
}: {
  children: (player: Player, metrics: PlayerMetrics | undefined) => ReactNode;
  metricsByMember: Map<string, PlayerMetrics>;
  players: Player[];
}) {
  return (
    <div
      className="grid gap-3 sm:[grid-template-columns:repeat(var(--player-count),minmax(12rem,1fr))]"
      style={playerGridStyle(players.length)}
    >
      {players.map((player) => (
        <div
          key={player.memberId}
          className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
        >
          <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {player.displayName}
          </h3>
          <div className="mt-3 grid gap-2">
            {children(player, metricsByMember.get(player.memberId))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-[var(--color-border)] pb-2 last:border-b-0 last:pb-0">
      <span className="min-w-0 text-xs text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-right text-sm font-semibold text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

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
  const spread = averageRankSpread(response);
  const ginji = ginjiSummary(response);
  const quality = qualitySummary(response);

  return (
    <section className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-4">
      <SummaryItem label="対戦回数" value={`${response.matchCount}戦`} />
      <SummaryItem
        label="平均順位差"
        value={spread.spread === undefined ? "-" : spread.spread.toFixed(2)}
        subLabel={spread.label}
        tone={spread.tone === "flat" || spread.tone === "small" ? "neutral" : "notice"}
      />
      <SummaryItem
        label="銀次発生"
        value={`${ginji.totalEncounters}回`}
        subLabel={
          ginji.abnormalMatches > 0 ? `2回以上の試合 ${ginji.abnormalMatches}` : "2回以上なし"
        }
        tone={ginji.abnormalMatches > 0 ? "danger" : "neutral"}
      />
      <SummaryItem
        label="参考指標"
        value={`${quality.referenceCount}件`}
        subLabel={quality.noTargetCount > 0 ? `対象なし ${quality.noTargetCount}件` : "対象あり"}
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
  tone?: "neutral" | "notice" | "danger";
  value: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[var(--radius-sm)] border p-3",
        tone === "danger"
          ? "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/8"
          : tone === "notice"
            ? "border-[var(--color-review)]/45 bg-[var(--color-review)]/10"
            : "border-[var(--color-border)] bg-[var(--color-surface-subtle)]",
      )}
    >
      <p className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">{value}</p>
      {subLabel ? (
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{subLabel}</p>
      ) : null}
    </div>
  );
}

function Highlights({ response }: { response: SeriesComparisonResponse }) {
  const highlights = response.highlights ?? [];
  if (highlights.length === 0) {
    return null;
  }
  const playersById = new Map((response.players ?? []).map((player) => [player.memberId, player]));
  return (
    <section className="flex min-w-0 flex-wrap gap-2">
      {highlights.map((highlight) => (
        <span
          key={highlight.id}
          className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm shadow-sm"
        >
          <span className="font-semibold text-[var(--color-text-primary)]">{highlight.title}</span>
          <span className="text-[var(--color-text-secondary)]">
            {(highlight.winnerMemberIds ?? [])
              .map((id) => playersById.get(id)?.displayName ?? id)
              .join(" / ")}
          </span>
        </span>
      ))}
    </section>
  );
}

function BasicMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="順位の平均と分布です。平均順位差は0.30を超えたら接戦ではなく、差が見え始めた扱いにします。"
      icon={<Trophy className="size-5" />}
      title="順位"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow label="平均順位" value={formatDecimal(metrics?.rank.average)} />
            {(metrics?.rank.distribution ?? []).map((item) => (
              <MetricRow
                key={item.rank}
                label={`${item.rank}位`}
                value={`${item.count}回 / ${formatPercent(item.rate)}`}
              />
            ))}
          </>
        )}
      </PlayerMetricGrid>
      <LineChart
        domain={[1, 4]}
        formatValue={(value) => `${value.toFixed(0)}位`}
        players={players}
        series={response.trends.rankCumulativeAverage ?? []}
      />
    </MetricSection>
  );
}

function MoneyMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <>
      <MetricSection
        description="総資産は勝敗に近い状態指標として、最低値も含めて分布を見ます。"
        icon={<Coins className="size-5" />}
        title="総資産"
      >
        <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
          {(_, metrics) => (
            <>
              <MetricRow label="最高額" value={formatMoney(metrics?.assets.max)} />
              <MetricRow label="最低額" value={formatMoney(metrics?.assets.min)} />
              <MetricRow label="平均値" value={formatMoney(metrics?.assets.average)} />
              <MetricRow label="中央値" value={formatMoney(metrics?.assets.median)} />
            </>
          )}
        </PlayerMetricGrid>
        <HistogramChart histogram={response.histograms.assets} players={players} />
      </MetricSection>
      <MetricSection
        description="収益の最低値は参考にしません。爆発力と普段の稼ぎ方を見る指標に絞ります。"
        icon={<BadgeDollarSign className="size-5" />}
        title="収益"
      >
        <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
          {(_, metrics) => (
            <>
              <MetricRow label="最高額" value={formatMoney(metrics?.revenue.max)} />
              <MetricRow label="平均値" value={formatMoney(metrics?.revenue.average)} />
              <MetricRow label="中央値" value={formatMoney(metrics?.revenue.median)} />
            </>
          )}
        </PlayerMetricGrid>
        <HistogramChart histogram={response.histograms.revenue} players={players} />
      </MetricSection>
    </>
  );
}

function RateMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="1・2位を入賞、3・4位を下位として、勝ち切り方と沈み方を見ます。"
      icon={<BarChart3 className="size-5" />}
      title="入賞率"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow
              label="1・2位"
              value={`${metrics?.podium.count ?? 0}回 / ${formatPercent(metrics?.podium.rate)}`}
            />
            <MetricRow
              label="3・4位"
              value={`${metrics?.lowerHalf.count ?? 0}回 / ${formatPercent(metrics?.lowerHalf.rate)}`}
            />
            <MetricRow
              label="順位の標準偏差"
              value={formatDecimal(metrics?.stability.rankStandardDeviation)}
            />
          </>
        )}
      </PlayerMetricGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <LineChart
          domain={[0, 1]}
          formatValue={(value) => formatPercent(value)}
          players={players}
          series={response.trends.podiumCumulativeRate ?? []}
        />
        <LineChart
          domain={[0, 1]}
          formatValue={(value) => formatPercent(value)}
          players={players}
          series={response.trends.lowerHalfCumulativeRate ?? []}
        />
      </div>
    </MetricSection>
  );
}

function CorrectionMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="同じプレー順の平均に対してどれだけ上振れ・下振れしたかを見ます。指数は1.00がプレー順平均です。"
      icon={<RefreshCw className="size-5" />}
      title="プレー順補正"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow
              label="総資産差"
              value={formatSigned(metrics?.playOrder.assetsDiff, "万円")}
            />
            <MetricRow
              label="収益差"
              value={formatSigned(metrics?.playOrder.revenueDiff, "万円")}
            />
            <MetricRow label="総資産指数" value={formatDecimal(metrics?.playOrder.assetsIndex)} />
            <MetricRow label="収益指数" value={formatDecimal(metrics?.playOrder.revenueIndex)} />
          </>
        )}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

function GinjiMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="銀次は1回でも被害が大きく、2回以上はかなり異常な事故として扱います。"
      icon={<ShieldAlert className="size-5" />}
      title="スリの銀次"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow label="遭遇回数" value={`${metrics?.ginji.count ?? 0}回`} />
            <MetricRow
              label="遭遇率"
              value={`${metrics?.ginji.encounterMatches ?? 0}戦 / ${formatPercent(metrics?.ginji.encounterRate)}`}
            />
            <MetricRow
              label="2回以上の試合"
              value={`${metrics?.ginji.multiEncounterMatchCount ?? 0}戦`}
            />
            <MetricRow label="1試合最多" value={`${metrics?.ginji.maxInSingleMatch ?? 0}回`} />
            <MetricRow
              label="銀次時の平均順位"
              value={formatDecimal(metrics?.ginji.resilienceRankAverage)}
            />
            <MetricRow
              label="銀次時の平均総資産"
              value={formatMoney(metrics?.ginji.resilienceAssetsAverage)}
            />
            <MetricRow
              label="銀次時の平均収益"
              value={formatMoney(metrics?.ginji.resilienceRevenueAverage)}
            />
          </>
        )}
      </PlayerMetricGrid>
      <LineChart
        formatValue={(value) => `${value.toFixed(0)}回`}
        players={players}
        series={response.trends.ginjiCumulativeCount ?? []}
      />
    </MetricSection>
  );
}

function ContextMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="稼ぎや目的地到着が最終順位へ変換できているかを見ます。事件簿は合算しても総行動数にはしません。"
      icon={<MapPinned className="size-5" />}
      title="収益外成績・目的地依存"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow label="収益外順位" value={formatSigned(metrics?.nonRevenue.rankDelta)} />
            <MetricRow
              label="高収益未勝利"
              value={`${metrics?.nonRevenue.highRevenueNoWinCount ?? 0}/${metrics?.nonRevenue.highRevenueTopCount ?? 0}・${formatPercent(metrics?.nonRevenue.highRevenueNoWinRate)}`}
            />
            <MetricRow
              label="目的地変換差"
              value={formatSigned(metrics?.destination.conversionDelta)}
            />
            <MetricRow
              label="目的地依存度"
              value={formatSigned(metrics?.destination.dependenceScore)}
            />
          </>
        )}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

function DataQualityNotice({ response }: { response: SeriesComparisonResponse }) {
  const summary = qualitySummary(response);
  if (summary.referenceCount === 0 && summary.noTargetCount === 0) {
    return null;
  }
  return (
    <Notice tone="info" title="参考扱いの指標があります。">
      銀次耐性、高収益未勝利率、目的地依存度は条件付き指標です。対象試合が少ない項目は参考扱いで表示します。
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

  return (
    <PageFrame className="gap-5" width="wide">
      <PageHeader
        actions={
          <Button
            disabled={!controller.canRefresh}
            icon={<RefreshCw className="size-4" />}
            pending={controller.aggregateRefreshing}
            pendingLabel="更新中"
            variant="secondary"
            onClick={controller.refresh}
          >
            更新
          </Button>
        }
        description="確定済みの戦績から、シリーズ単位で各プレーヤーの順位、資産、収益、銀次、目的地依存を比較します。"
        eyebrow="分析"
        title="シリーズ比較"
      />

      {controller.hasOptionsError ? (
        <Notice tone="danger" title="シリーズ候補を読み込めませんでした。">
          通信状態を確認してから再読み込みしてください。
        </Notice>
      ) : null}

      {seriesOptions.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="size-5" />}
          title="比較できるシリーズがありません"
          description="確定済みの試合とシリーズのマスタが揃うと、この画面で比較できます。"
        />
      ) : (
        <>
          <section className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-[minmax(12rem,1fr)_auto_minmax(12rem,1fr)] md:items-end">
            <SelectField
              label="シリーズ"
              options={seriesOptions}
              value={controller.state.gameTitleId ?? ""}
              onChange={(event) => controller.updateGameTitle(event.currentTarget.value)}
            />
            <div className="md:pb-1">
              <SegmentedControl
                label="比較範囲"
                options={controller.scopeKinds}
                value={controller.state.scopeKind}
                onValueChange={(value) =>
                  controller.updateScopeKind(value as "overall" | "season" | "map")
                }
              />
            </div>
            {controller.state.scopeKind === "overall" ? (
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
                全シーズン・全マップ
              </div>
            ) : (
              <SelectField
                label={controller.state.scopeKind === "season" ? "シーズン" : "マップ"}
                options={controller.scopeOptions.map((option) => ({
                  label: `${option.name} (${option.confirmedMatchCount}戦)`,
                  value: option.id,
                }))}
                value={controller.state.scopeId ?? ""}
                onChange={(event) => controller.updateScopeId(event.currentTarget.value)}
              />
            )}
          </section>

          {controller.hasAggregateError ? (
            <Notice tone="danger" title="比較データを読み込めませんでした。">
              条件を変えるか、少し時間を置いて再読み込みしてください。
            </Notice>
          ) : controller.aggregateLoading ? (
            <ComparisonSkeleton />
          ) : controller.aggregate && controller.aggregate.matchCount === 0 ? (
            <EmptyState
              icon={<BarChart3 className="size-5" />}
              title="この範囲に確定済みの試合がありません"
              description="別のシーズン、マップ、または総合を選ぶと表示できる場合があります。"
            />
          ) : controller.aggregate ? (
            <>
              <div className="text-sm text-[var(--color-text-secondary)]">
                {controller.selectedSeries?.name} / {controller.scopeName}
              </div>
              <SummaryBand response={controller.aggregate} />
              <Highlights response={controller.aggregate} />
              <DataQualityNotice response={controller.aggregate} />
              <BasicMetrics response={controller.aggregate} />
              <MoneyMetrics response={controller.aggregate} />
              <RateMetrics response={controller.aggregate} />
              <CorrectionMetrics response={controller.aggregate} />
              <GinjiMetrics response={controller.aggregate} />
              <ContextMetrics response={controller.aggregate} />
            </>
          ) : null}
        </>
      )}
    </PageFrame>
  );
}
