import {
  Activity,
  BadgeDollarSign,
  BarChart3,
  Clock3,
  Coins,
  HelpCircle,
  MapPinned,
  RefreshCw,
  ShieldAlert,
  Swords,
  Trophy,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  HeadToHeadMatrix,
  HistogramChart,
  LineChart,
  StrategyProfileChart,
  StrategyScatterPlot,
  playerColor,
  playerGridStyle,
} from "@/features/seriesComparison/SeriesComparisonCharts";
import type {
  MatchNoBreakdown,
  MetricTone,
  Player,
  PlayerMetrics,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import {
  extremumTone,
  formatDecimal,
  formatMoney,
  formatPercent,
  formatPlayOrderLabel,
  formatSigned,
  leaderSummary,
  metricsMap,
  numericExtrema,
  performanceProfileMap,
  playOrderColor,
  playerNameMap,
  recentFormMap,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import {
  averageRankSpread,
  ginjiSummary,
  playOrderSignal,
  qualitySummary,
  statusLabel,
  strategyKindLabel,
  timelineFlagLabel,
} from "@/features/seriesComparison/seriesComparisonViewModel";
import { useSeriesComparisonPageController } from "@/features/seriesComparison/useSeriesComparisonPageController";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
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

function MetricRow({
  help,
  label,
  tone = "neutral",
  value,
}: {
  help?: ReactNode;
  label: string;
  tone?: MetricTone;
  value: ReactNode;
}) {
  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-[var(--color-border)] pb-2 last:border-b-0 last:pb-0">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
        <span className="truncate">{label}</span>
        {help ? <FormulaHelp content={help} /> : null}
      </span>
      <span
        className={cn(
          "text-right text-sm font-semibold tabular-nums",
          tone === "high"
            ? "text-[var(--color-success)]"
            : tone === "low"
              ? "text-[var(--color-review)]"
              : "text-[var(--color-text-primary)]",
        )}
      >
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

function StatusBadge({ status }: { status: string | null | undefined }) {
  const label = statusLabel(status);
  if (!label) {
    return null;
  }
  return (
    <span className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
      {label}
    </span>
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
          rankSpread.spread === undefined ? "平均順位の比較材料不足" : "平均順位の首位と最下位の差"
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

function RecentFormMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const recentByMember = recentFormMap(response);
  return (
    <MetricSection
      description="直近8戦の平均順位と入賞率、最新試合から続いている状態です。通常2開催日分を目安に見ます。対象3戦未満は参考値として扱います。"
      icon={<Activity className="size-5" />}
      title="直近フォーム"
    >
      <PlayerMetricGrid metricsByMember={metricsMap(response)} players={players}>
        {(player) => {
          const form = recentByMember.get(player.memberId);
          return (
            <>
              <div className="flex justify-end">
                <StatusBadge status={form?.status} />
              </div>
              <MetricRow
                label="直近平均順位"
                value={`${formatDecimal(form?.averageRank)} / ${form?.targetCount ?? 0}戦`}
              />
              <MetricRow label="直近入賞率" value={formatPercent(form?.podiumRate)} />
              <MetricRow label="連勝" value={`${form?.winStreak ?? 0}戦`} />
              <MetricRow label="連続入賞" value={`${form?.podiumStreak ?? 0}戦`} />
              <MetricRow label="連続沈没" value={`${form?.lowerHalfStreak ?? 0}戦`} />
            </>
          );
        }}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

function BasicMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="平均順位は1に近いほど上位です。順位ごとの回数で、勝ち方と沈み方を確認します。"
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
      <MatchResultStrip response={response} />
    </MetricSection>
  );
}

function HeadToHeadMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  return (
    <MetricSection
      description="行の社長が列の相手より上位だった割合です。セル内の件数を見て、少数試合の相性は参考として読みます。"
      icon={<Swords className="size-5" />}
      title="直接対決"
    >
      <HeadToHeadMatrix entries={response.headToHead.entries ?? []} players={players} />
    </MetricSection>
  );
}

function MoneyMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  const extrema = {
    assetsAverage: numericExtrema(response, (metrics) => metrics.assets.average),
    assetsMax: numericExtrema(response, (metrics) => metrics.assets.max),
    assetsMedian: numericExtrema(response, (metrics) => metrics.assets.median),
    assetsMin: numericExtrema(response, (metrics) => metrics.assets.min),
    revenueAverage: numericExtrema(response, (metrics) => metrics.revenue.average),
    revenueMax: numericExtrema(response, (metrics) => metrics.revenue.max),
    revenueMedian: numericExtrema(response, (metrics) => metrics.revenue.median),
  };
  return (
    <>
      <MetricSection
        description="試合後にどれだけ資産を残したかを見ます。最高額だけでなく、落ち込んだ試合の底も比較します。"
        icon={<Coins className="size-5" />}
        title="総資産"
      >
        <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
          {(_, metrics) => (
            <>
              <MetricRow
                label="最高額"
                tone={extremumTone(metrics?.assets.max, extrema.assetsMax, "max")}
                value={formatMoney(metrics?.assets.max)}
              />
              <MetricRow
                label="最低額"
                tone={extremumTone(metrics?.assets.min, extrema.assetsMin, "min")}
                value={formatMoney(metrics?.assets.min)}
              />
              <MetricRow
                label="平均値"
                tone={extremumTone(metrics?.assets.average, extrema.assetsAverage, "max")}
                value={formatMoney(metrics?.assets.average)}
              />
              <MetricRow
                label="中央値"
                tone={extremumTone(metrics?.assets.median, extrema.assetsMedian, "max")}
                value={formatMoney(metrics?.assets.median)}
              />
            </>
          )}
        </PlayerMetricGrid>
        <HistogramChart histogram={response.histograms.assets} players={players} />
      </MetricSection>
      <MetricSection
        description="その試合でどれだけ収益を出せたかを見ます。最高額は爆発力、平均と中央値は普段の収益力の目安です。"
        icon={<BadgeDollarSign className="size-5" />}
        title="収益"
      >
        <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
          {(_, metrics) => (
            <>
              <MetricRow
                label="最高額"
                tone={extremumTone(metrics?.revenue.max, extrema.revenueMax, "max")}
                value={formatMoney(metrics?.revenue.max)}
              />
              <MetricRow
                label="平均値"
                tone={extremumTone(metrics?.revenue.average, extrema.revenueAverage, "max")}
                value={formatMoney(metrics?.revenue.average)}
              />
              <MetricRow
                label="中央値"
                tone={extremumTone(metrics?.revenue.median, extrema.revenueMedian, "max")}
                value={formatMoney(metrics?.revenue.median)}
              />
            </>
          )}
        </PlayerMetricGrid>
        <HistogramChart histogram={response.histograms.revenue} players={players} />
      </MetricSection>
    </>
  );
}

function PerformanceShapeMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const profileByMember = performanceProfileMap(response);
  return (
    <MetricSection
      description="総資産に対して収益がどれだけ占めるかで勝ち筋を見ます。収益比率が高いほど桃鉄型（物件重視）、低いほど遊戯王型（カード重視）として読みます。"
      icon={<BarChart3 className="size-5" />}
      title="勝ち筋の形"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] xl:items-start">
        <StrategyScatterPlot players={players} points={response.matchPlayerPoints ?? []} />
        <StrategyProfileChart players={players} profiles={response.playerPerformanceProfiles} />
      </div>
      <PlayerMetricGrid metricsByMember={metricsMap(response)} players={players}>
        {(player) => {
          const profile = profileByMember.get(player.memberId);
          return (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {strategyKindLabel(profile?.strategyKind)}
                </span>
                <StatusBadge status={profile?.status} />
              </div>
              <MetricRow
                label="収益比率"
                help="総資産が正の試合だけを対象にした、収益 / 総資産 の平均です。"
                value={formatPercent(profile?.averageRevenueAssetRate)}
              />
              <MetricRow
                label="順位スコア"
                help="5 - 最終順位の平均。1位=4点、4位=1点として扱います。"
                value={formatDecimal(profile?.averageRankScore)}
              />
              <MetricRow label="入賞率" value={formatPercent(profile?.podiumRate)} />
            </>
          );
        }}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

function RateMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="1・2位で終えた割合と、3・4位に沈んだ割合です。順位ブレは小さいほど安定しています。"
      icon={<BarChart3 className="size-5" />}
      title="上位率と順位ブレ"
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
      <LineChart
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
      description="プレー順ごとの平均順位から、得意なPと苦手なP、その差を見ます。P差は小さいほどプレー順による成績差が小さい状態です。"
      icon={<RefreshCw className="size-5" />}
      title="プレー順別成績"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
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
      <MetricRow label="得意P" value={<PlayOrderValue item={signal.best} />} />
      <MetricRow label="苦手P" value={<PlayOrderValue item={signal.worst} />} />
      <MetricRow
        help="各プレーヤーのプレー順別平均順位の最大値 - 最小値。大きいほどプレー順で成績差が出ています。"
        label="P差"
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
        平均順位 {formatDecimal(item.rankAverage)} / {item.matchCount}戦
      </span>
    </span>
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
      description="収益や目的地到着が、最終順位にどれだけ効いているかを見ます。事件簿は駅の種類ごとの記録で、合算して総行動数にはしません。"
      icon={<MapPinned className="size-5" />}
      title="収益と目的地の効き方"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow
              help="各試合の「収益順位 - 最終順位」を平均。マイナスなら、収益順位に比べて最終順位が低めです。"
              label="収益順位との差"
              value={formatSigned(metrics?.nonRevenue.rankDelta)}
            />
            <MetricRow
              help="収益が全員中トップだった試合のうち、最終1位ではなかった割合。"
              label="収益トップ未勝利"
              value={`${metrics?.nonRevenue.highRevenueNoWinCount ?? 0}/${metrics?.nonRevenue.highRevenueTopCount ?? 0}・${formatPercent(metrics?.nonRevenue.highRevenueNoWinRate)}`}
            />
            <MetricRow
              help="各試合の「目的地到着数順位 - 最終順位」を平均。マイナスなら、目的地到着数に比べて最終順位が低めです。"
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
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          荒れ試合ダイジェスト
        </h3>
        <p className="text-xs text-pretty text-[var(--color-text-secondary)]">
          全試合ではなく、荒れ要因の件数と該当試合だけを順位推移と合わせて確認します。
        </p>
      </div>
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
          荒れ試合ラベルの付いた試合はありません。
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
                    <p className="mt-0.5 truncate text-sm font-semibold text-[var(--color-text-primary)]">
                      {names.get(point.winnerMemberId ?? "") ?? "勝者不明"}
                    </p>
                  </div>
                  <StatusBadge status={point.status} />
                </div>
                <div className="mt-2 grid gap-1 text-xs text-[var(--color-text-secondary)]">
                  <div className="flex justify-between gap-2">
                    <span>1-2位差</span>
                    <span className="text-[var(--color-text-primary)] tabular-nums">
                      {formatMoney(point.assetGapFirstToSecond)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>1-4位差</span>
                    <span className="text-[var(--color-text-primary)] tabular-nums">
                      {formatMoney(point.assetGapFirstToLast)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>銀次</span>
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
              直近8件の荒れ試合だけを表示しています。
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
      description="1開催4試合を基本として、第1〜第4試合の平均順位と入賞率を見ます。5試合目以降がある場合は折りたたんで表示します。"
      icon={<Clock3 className="size-5" />}
      title="開催回内の流れ"
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
            className="truncate rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1.5 text-center text-xs font-semibold text-[var(--color-text-primary)]"
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
    <Notice tone="info" title="条件付きの指標があります。">
      銀次遭遇試合の平均、収益トップ未勝利、目的地で勝ち切りは条件付き指標です。対象試合がない項目は「-」、対象試合が少ない項目は参考値として表示します。
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
        description="最新作品の確定済み戦績から、4人の順位、総資産、収益、銀次、目的地の効き方を比較します。"
        eyebrow="分析"
        title="戦績比較"
      />

      {controller.hasOptionsError ? (
        <Notice tone="danger" title="対象作品を読み込めませんでした。">
          通信状態を確認してから再読み込みしてください。
        </Notice>
      ) : null}

      {seriesOptions.length === 0 && !controller.hasOptionsError ? (
        <EmptyState
          icon={<BarChart3 className="size-5" />}
          title="比較できる戦績がありません"
          description="確定済みの試合と作品情報が揃うと、この画面で比較できます。"
        />
      ) : seriesOptions.length > 0 ? (
        <>
          <section className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-[auto_minmax(12rem,1fr)_minmax(12rem,1fr)] md:items-end">
            <div className="md:pb-1">
              <SegmentedControl
                label="表示範囲"
                options={controller.scopeKinds}
                value={controller.state.scopeKind}
                onValueChange={(value) =>
                  controller.updateScopeKind(value as "overall" | "season" | "map")
                }
              />
            </div>
            {controller.state.scopeKind === "overall" ? (
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)] md:mb-1">
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
            <SelectField
              label="対象作品"
              options={seriesOptions}
              value={controller.state.gameTitleId ?? ""}
              onChange={(event) => controller.updateGameTitle(event.currentTarget.value)}
            />
          </section>

          {controller.hasAggregateError ? (
            <Notice tone="danger" title="戦績データを読み込めませんでした。">
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
              <RecentFormMetrics response={controller.aggregate} />
              <DataQualityNotice response={controller.aggregate} />
              <BasicMetrics response={controller.aggregate} />
              <HeadToHeadMetrics response={controller.aggregate} />
              <MoneyMetrics response={controller.aggregate} />
              <PerformanceShapeMetrics response={controller.aggregate} />
              <RateMetrics response={controller.aggregate} />
              <PlayOrderMetrics response={controller.aggregate} />
              <GinjiMetrics response={controller.aggregate} />
              <ContextMetrics response={controller.aggregate} />
              <MatchNoInEventMetrics response={controller.aggregate} />
            </>
          ) : null}
        </>
      ) : null}
    </PageFrame>
  );
}
