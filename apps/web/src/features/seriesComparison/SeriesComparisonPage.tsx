import {
  BadgeDollarSign,
  BarChart3,
  Coins,
  HelpCircle,
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
import { Tooltip } from "@/shared/ui/feedback/Tooltip";
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

function formatPlayOrderLabel(playOrder: number | undefined): string {
  return playOrder === undefined ? "プレー順不明" : `プレー順${playOrder}`;
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

function MetricRow({ help, label, value }: { help?: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-[var(--color-border)] pb-2 last:border-b-0 last:pb-0">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
        <span className="truncate">{label}</span>
        {help ? <FormulaHelp content={help} /> : null}
      </span>
      <span className="text-right text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
        {value}
      </span>
    </div>
  );
}

function FormulaHelp({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <button
        aria-label="計算式を表示"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
        type="button"
      >
        <HelpCircle aria-hidden="true" className="size-3.5" />
      </button>
    </Tooltip>
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
  const rankSpread = averageRankSpread(response);

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
        label="順位の開き"
        value={formatDecimal(rankSpread.spread)}
        subLabel={
          rankSpread.spread === undefined
            ? rankSpread.label
            : `平均順位の首位と最下位の差 / ${rankSpread.label}`
        }
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
        formatValue={(value) => `${value.toFixed(0)}位`}
        lowValueAtTop
        players={players}
        series={response.trends.rankCumulativeAverage ?? []}
        yTicks={[1, 2, 3, 4]}
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
        description="その試合でどれだけ収益を出せたかを見ます。最高額は爆発力、平均と中央値は普段の収益力の目安です。"
        icon={<BadgeDollarSign className="size-5" />}
        title="収益の強さ"
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
              help="平均順位からの標準偏差。小さいほど順位が安定しています。"
              value={formatDecimal(metrics?.stability.rankStandardDeviation)}
            />
          </>
        )}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

function PlayOrderMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="同じプレーヤーが、どのプレー順でどの成績になっているかを見ます。全体平均は、プレー順自体の傾向を見るための基準です。"
      icon={<RefreshCw className="size-5" />}
      title="プレー順別成績"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => <PlayOrderBreakdown breakdown={metrics?.playOrder.breakdown ?? []} />}
      </PlayerMetricGrid>
      <PlayOrderBaselineTable response={response} />
    </MetricSection>
  );
}

function PlayOrderBreakdown({
  breakdown,
}: {
  breakdown: NonNullable<PlayerMetrics["playOrder"]["breakdown"]>;
}) {
  if (breakdown.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">対象データなし</p>;
  }
  return (
    <div className="grid gap-2">
      {breakdown.map((item) => (
        <div
          key={item.playOrder}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
        >
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--color-text-primary)]">
            <span>{formatPlayOrderLabel(item.playOrder)}</span>
            <span className="text-[var(--color-text-secondary)] tabular-nums">
              {item.matchCount}戦
            </span>
          </div>
          <div className="mt-2 grid gap-1 text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[var(--color-text-secondary)]">平均順位</span>
              <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                {formatDecimal(item.rankAverage)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[var(--color-text-secondary)]">総資産</span>
              <span className="text-right font-semibold text-[var(--color-text-primary)] tabular-nums">
                {formatMoney(item.assetsAverage)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[var(--color-text-secondary)]">収益</span>
              <span className="text-right font-semibold text-[var(--color-text-primary)] tabular-nums">
                {formatMoney(item.revenueAverage)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayOrderBaselineTable({ response }: { response: SeriesComparisonResponse }) {
  const baselines = response.playOrderBaselines ?? [];
  if (baselines.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">全体のプレー順平均</h3>
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
              {formatPlayOrderLabel(baseline.playOrder)}
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
      description="収益や目的地到着を、最終順位にどれだけつなげられたかを見ます。事件簿は駅の種類ごとの記録で、合算して総行動数にはしません。"
      icon={<MapPinned className="size-5" />}
      title="収益と目的地の変換"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow
              help="各試合の「収益順位 - 最終順位」を平均。マイナスは収益順位ほど最終順位が伸びなかった状態です。"
              label="収益順位との差"
              value={formatSigned(metrics?.nonRevenue.rankDelta)}
            />
            <MetricRow
              help="収益が全員中トップだった試合のうち、最終1位ではなかった割合。"
              label="収益トップ未勝利"
              value={`${metrics?.nonRevenue.highRevenueNoWinCount ?? 0}/${metrics?.nonRevenue.highRevenueTopCount ?? 0}・${formatPercent(metrics?.nonRevenue.highRevenueNoWinRate)}`}
            />
            <MetricRow
              help="各試合の「目的地到着数順位 - 最終順位」を平均。マイナスは目的地到着数ほど最終順位が伸びなかった状態です。"
              label="目的地順位との差"
              value={formatSigned(metrics?.destination.conversionDelta)}
            />
            <MetricRow
              help="目的地到着数が上位の試合で得た順位点から、下位の試合で得た順位点を引いた値。順位点は「5 - 最終順位」です。"
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
      銀次遭遇試合の平均、収益トップ未勝利、目的地で勝ち切りは条件付き指標です。対象試合が少ない項目は参考扱いで表示します。
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
        description="確定済みの戦績から、シリーズ単位で各プレーヤーの順位、総資産、収益、銀次、目的地の効き方を比較します。"
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
              <PlayOrderMetrics response={controller.aggregate} />
              <GinjiMetrics response={controller.aggregate} />
              <ContextMetrics response={controller.aggregate} />
            </>
          ) : null}
        </>
      )}
    </PageFrame>
  );
}
