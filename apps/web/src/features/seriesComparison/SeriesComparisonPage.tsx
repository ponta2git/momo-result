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
  playerColor,
  playerGridStyle,
} from "@/features/seriesComparison/SeriesComparisonCharts";
import {
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
  return value === undefined ? "-" : `${(value * 100).toFixed(1)}%`;
}

function formatMoney(value: number | undefined): string {
  return value === undefined ? "-" : formatManYen(Math.round(value));
}

function metricsMap(response: SeriesComparisonResponse): Map<string, PlayerMetrics> {
  return new Map((response.metricsByPlayer ?? []).map((entry) => [entry.memberId, entry.metrics]));
}

function leaderSummary(response: SeriesComparisonResponse): {
  averageRank: number | undefined;
  gapToSecond: number | undefined;
  name: string | undefined;
} {
  const playersById = new Map((response.players ?? []).map((player) => [player.memberId, player]));
  const ranked = (response.metricsByPlayer ?? [])
    .flatMap((entry) =>
      entry.metrics.rank.average === undefined
        ? []
        : [{ averageRank: entry.metrics.rank.average, memberId: entry.memberId }],
    )
    .toSorted((a, b) => a.averageRank - b.averageRank);
  const leader = ranked[0];
  if (!leader) {
    return { averageRank: undefined, gapToSecond: undefined, name: undefined };
  }
  return {
    averageRank: leader.averageRank,
    gapToSecond: ranked[1] ? ranked[1].averageRank - leader.averageRank : undefined,
    name: playersById.get(leader.memberId)?.displayName ?? leader.memberId,
  };
}

function revenueMissSummary(response: SeriesComparisonResponse): {
  noWinCount: number;
  rate: number | undefined;
  topCount: number;
} {
  const totals = (response.metricsByPlayer ?? []).reduce(
    (acc, entry) => ({
      noWinCount: acc.noWinCount + entry.metrics.nonRevenue.highRevenueNoWinCount,
      topCount: acc.topCount + entry.metrics.nonRevenue.highRevenueTopCount,
    }),
    { noWinCount: 0, topCount: 0 },
  );
  return {
    ...totals,
    rate: totals.topCount > 0 ? totals.noWinCount / totals.topCount : undefined,
  };
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
  children: (player: Player, metrics: PlayerMetrics | undefined, index: number) => ReactNode;
  metricsByMember: Map<string, PlayerMetrics>;
  players: Player[];
}) {
  return (
    <div
      className="grid gap-3 sm:[grid-template-columns:repeat(var(--player-count),minmax(12rem,1fr))]"
      style={playerGridStyle(players.length)}
    >
      {players.map((player, index) => (
        <div
          key={player.memberId}
          className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
          style={{ borderTopColor: playerColor(index), borderTopWidth: 3 }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: playerColor(index) }}
            />
            <span className="shrink-0 text-xs font-medium text-[var(--color-text-secondary)]">
              {index + 1}P
            </span>
            <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
              {player.displayName}
            </h3>
          </div>
          <div className="mt-3 grid gap-2">
            {children(player, metricsByMember.get(player.memberId), index)}
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
  const ginji = ginjiSummary(response);
  const leader = leaderSummary(response);
  const revenueMiss = revenueMissSummary(response);

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
                  : ` / 2位平均との差 ${leader.gapToSecond.toFixed(2)}`
              }`
        }
      />
      <SummaryItem
        label="銀次発生"
        value={`${ginji.totalEncounters}回`}
        subLabel={
          ginji.abnormalMatches > 0 ? `2回以上の試合 ${ginji.abnormalMatches}` : "2回以上なし"
        }
      />
      <SummaryItem
        label="稼ぎトップ未勝利"
        value={formatPercent(revenueMiss.rate)}
        subLabel={`${revenueMiss.noWinCount}/${revenueMiss.topCount}件`}
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

function BasicMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="まず勝敗の地力を見ます。平均順位は1に近いほど上位で、順位ごとの回数から勝ち方と沈み方も追えます。"
      icon={<Trophy className="size-5" />}
      title="順位の地力"
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
        formatValue={(value) => `${value.toFixed(Number.isInteger(value) ? 0 : 1)}位`}
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
        description="試合後にどれだけ持ち物を残せたかを見ます。最高額だけでなく、落ち込んだ試合の底も比較します。"
        icon={<Coins className="size-5" />}
        title="総資産の残し方"
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
        description="その試合でどれだけ稼げたかを見ます。最高額は爆発力、平均と中央値は普段の稼ぎ方の目安です。"
        icon={<BadgeDollarSign className="size-5" />}
        title="稼ぎの強さ"
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
      description="1・2位で終えた割合と、3・4位に沈んだ割合です。順位ブレは小さいほど安定しています。"
      icon={<BarChart3 className="size-5" />}
      title="上位キープ"
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
              label="順位ブレ"
              value={formatDecimal(metrics?.stability.rankStandardDeviation)}
            />
          </>
        )}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

function CorrectionMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="同じ席番の平均からどれだけ上振れ・下振れしたかを見ます。倍率は1.00が席番平均です。席番の有利不利を完全に消すものではなく、読み解き用の参考値です。"
      icon={<RefreshCw className="size-5" />}
      title="席順平均との差"
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
            <MetricRow label="総資産倍率" value={formatDecimal(metrics?.playOrder.assetsIndex)} />
            <MetricRow label="収益倍率" value={formatDecimal(metrics?.playOrder.revenueIndex)} />
          </>
        )}
      </PlayerMetricGrid>
      <PlayOrderBaselineTable response={response} />
    </MetricSection>
  );
}

function PlayOrderBaselineTable({ response }: { response: SeriesComparisonResponse }) {
  const baselines = response.playOrderBaselines ?? [];
  if (baselines.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">席番別の平均</h3>
      <div className="grid gap-3 md:grid-cols-4">
        {baselines.map((baseline) => (
          <div
            key={baseline.playOrder}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
            style={{
              borderTopColor: playerColor(Math.max(0, baseline.playOrder - 1)),
              borderTopWidth: 3,
            }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ backgroundColor: playerColor(Math.max(0, baseline.playOrder - 1)) }}
              />
              {baseline.playOrder}P
            </div>
            <div className="mt-3 grid gap-2">
              <MetricRow label="総資産平均" value={formatMoney(baseline.assetsAverage)} />
              <MetricRow label="収益平均" value={formatMoney(baseline.revenueAverage)} />
              <MetricRow label="対象" value={`${baseline.matchCount}戦`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GinjiMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="銀次は1回でも試合を動かす事故です。2回以上の試合はかなり珍しい被害として分けて見ます。"
      icon={<ShieldAlert className="size-5" />}
      title="銀次ダメージ"
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
              label="遭遇試合の平均順位"
              value={formatDecimal(metrics?.ginji.resilienceRankAverage)}
            />
            <MetricRow
              label="遭遇試合の平均総資産"
              value={formatMoney(metrics?.ginji.resilienceAssetsAverage)}
            />
            <MetricRow
              label="遭遇試合の平均収益"
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
      description="稼ぎや目的地到着を、最終順位にどれだけつなげられたかを見ます。差は「指標順位 - 最終順位」の平均で、マイナスほど指標の良さを順位に変えきれていません。事件簿は駅の種類ごとの記録で、合算して総行動数にはしません。"
      icon={<MapPinned className="size-5" />}
      title="稼ぎと目的地の変換"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow label="稼ぎ順位との差" value={formatSigned(metrics?.nonRevenue.rankDelta)} />
            <MetricRow
              label="稼ぎトップ未勝利"
              value={`${metrics?.nonRevenue.highRevenueNoWinCount ?? 0}/${metrics?.nonRevenue.highRevenueTopCount ?? 0}・${formatPercent(metrics?.nonRevenue.highRevenueNoWinRate)}`}
            />
            <MetricRow
              label="目的地順位との差"
              value={formatSigned(metrics?.destination.conversionDelta)}
            />
            <MetricRow
              label="目的地で勝ち切り"
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
      銀次遭遇試合の平均、稼ぎトップ未勝利、目的地で勝ち切りは条件付き指標です。対象試合が少ない項目は参考扱いで表示します。
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
        description="確定済みの戦績から、シリーズ単位で各プレーヤーの順位、資産、稼ぎ、銀次、目的地の効き方を比較します。"
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
