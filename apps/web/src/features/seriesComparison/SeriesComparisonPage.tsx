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
  Store,
  Swords,
  Trophy,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import {
  HeadToHeadMatrix,
  HistogramChart,
  LineChart,
  PlayOrderHeatmap,
  RankDistributionStackedBars,
  RecentRankStrip,
  RevenueRankConversionHeatmap,
  StrategyProfileChart,
  StrategyScatterPlot,
  playerColor,
  playerGridStyle,
} from "@/features/seriesComparison/SeriesComparisonCharts";
import { MetricSection } from "@/features/seriesComparison/SeriesComparisonMetricSection";
import type {
  AssetStyleProfileEntry,
  MatchNoBreakdown,
  MetricEmphasis,
  MomentumSwitchEntry,
  MomentumSwitchRateKey,
  PerformanceProfileEntry,
  Player,
  PlayerMetrics,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import {
  assetStyleProfileMap,
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
  momentumSwitchEmphasis,
  momentumSwitchMap,
  numericExtrema,
  performanceProfileMap,
  playOrderHeatmapRows,
  playOrderColor,
  playerNameMap,
  rankDistributionBars,
  recentFormMap,
  recentRankStrips,
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
  isSeriesComparisonViewId,
  playOrderSignal,
  qualitySummary,
  statusLabel,
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
import { Tooltip } from "@/shared/ui/feedback/Tooltip";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TabsList, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

function PlayerMetricGrid({
  cardClassName,
  children,
  contentClassName,
  minColumnWidthRem = 11,
  metricsByMember,
  players,
}: {
  cardClassName?: string;
  children: (player: Player, metrics: PlayerMetrics | undefined, index: number) => ReactNode;
  contentClassName?: string;
  minColumnWidthRem?: number;
  metricsByMember: Map<string, PlayerMetrics>;
  players: Player[];
}) {
  const gridStyle = {
    ...playerGridStyle(players.length),
    "--player-column-min": `${minColumnWidthRem}rem`,
  } as CSSProperties;
  return (
    <div className="max-w-full min-w-0 pb-1">
      <div
        className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(var(--player-count),minmax(var(--player-column-min),1fr))]"
        style={gridStyle}
      >
        {players.map((player, index) => (
          <div
            key={player.memberId}
            className={cn(
              "min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3",
              cardClassName,
            )}
            style={{ borderTopColor: playerColor(index), borderTopWidth: 3 }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: playerColor(index) }}
              />
              <p className="min-w-0 text-sm font-semibold break-words text-[var(--color-text-primary)]">
                {player.displayName}
              </p>
            </div>
            <div className={cn("mt-3 grid gap-2", contentClassName)}>
              {children(player, metricsByMember.get(player.memberId), index)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricRow({
  emphasis,
  help,
  label,
  status,
  value,
}: {
  emphasis?: MetricEmphasis | undefined;
  help?: ReactNode;
  label: string;
  status?: string | null | undefined;
  value: ReactNode;
}) {
  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-[var(--color-border)] pb-2 last:border-b-0 last:pb-0">
      <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-4 text-[var(--color-text-secondary)]">
        <span className="min-w-0 break-words">{label}</span>
        <StatusBadge status={status} />
        {emphasis ? <EmphasisBadge emphasis={emphasis} /> : null}
        {help ? <FormulaHelp content={help} label={label} /> : null}
      </span>
      <span
        className={cn(
          "min-w-0 text-right text-sm font-semibold break-words tabular-nums",
          emphasisTextClass(emphasis?.kind),
        )}
      >
        {value}
      </span>
    </div>
  );
}

function EmphasisBadge({ emphasis }: { emphasis: MetricEmphasis }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-[var(--radius-xs)] border px-1 py-px text-[10px] font-semibold leading-4",
        emphasisBadgeClass(emphasis.kind),
      )}
    >
      {emphasis.label}
    </span>
  );
}

function emphasisBadgeClass(kind: MetricEmphasis["kind"]): string {
  switch (kind) {
    case "strength":
      return "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-success)]";
    case "risk":
      return "border-[var(--color-review)]/55 bg-[var(--color-review)]/10 text-[var(--color-review)]";
    case "leader":
      return "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-success)]";
    default:
      return "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]";
  }
}

function emphasisTextClass(kind: MetricEmphasis["kind"] | undefined): string {
  switch (kind) {
    case "strength":
    case "leader":
      return "text-[var(--color-success)]";
    case "risk":
      return "text-[var(--color-review)]";
    default:
      return "text-[var(--color-text-primary)]";
  }
}

function FormulaHelp({ content, label }: { content: ReactNode; label: string }) {
  return (
    <Tooltip content={content}>
      <button
        aria-label={`「${label}」の計算式を表示`}
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

const perspectiveItems = [
  {
    description: "次回4戦で試す行動仮説を、発動条件と根拠で絞ります。",
    id: "review",
    label: "振り返り",
    sections: [{ id: "review-playbook", label: "行動プレイブック" }],
  },
  {
    description: "平均順位、直接対決、順位ブレで、地力と相性を確認します。",
    id: "overview",
    label: "順位と相性",
    sections: [
      { id: "metric-basic", label: "順位" },
      { id: "metric-head-to-head", label: "直接対決" },
      { id: "metric-rate", label: "安定性" },
    ],
  },
  {
    description: "総資産、物件収益、カード寄り、目的地到着から勝ち筋を確認します。",
    id: "drivers",
    label: "勝ち筋",
    sections: [
      { id: "metric-money", label: "資産と勝ち筋" },
      { id: "metric-revenue-outcome", label: "物件収益と勝ち" },
      { id: "metric-destination-outcome", label: "目的地と勝ち" },
    ],
  },
  {
    description: "荒れ試合、直近8戦、切り替え、第n試合別の傾向を確認します。",
    id: "flow",
    label: "流れと勢い",
    sections: [
      { id: "metric-match-digest", label: "期間内の荒れ" },
      { id: "metric-recent-form", label: "直近" },
      { id: "metric-momentum-switch", label: "切り替え" },
      { id: "metric-match-no", label: "第n試合傾向" },
    ],
  },
  {
    description: "番手、カード売り場、スリの銀次など、試合条件と出来事を確認します。",
    id: "context",
    label: "番手と出来事",
    sections: [
      { id: "metric-play-order", label: "番手" },
      { id: "metric-card-shop-destination", label: "売り場×目的地" },
      { id: "metric-ginji", label: "スリの銀次" },
    ],
  },
] satisfies AnalysisViewDefinition[];

type AnalysisViewDefinition = {
  description: string;
  id: SeriesComparisonViewId;
  label: string;
  sections: Array<{ id: string; label: string }>;
};

type AnalysisViewChange = (view: SeriesComparisonViewId, options?: { replace?: boolean }) => void;

function analysisViewFor(view: SeriesComparisonViewId | undefined): AnalysisViewDefinition {
  const fallback = perspectiveItems.find((item) => item.id === defaultSeriesComparisonView);
  if (!fallback) {
    throw new Error("default series comparison view is not configured");
  }
  return perspectiveItems.find((item) => item.id === view) ?? fallback;
}

function AnalysisTabs({
  activeView,
  onViewChange,
}: {
  activeView: SeriesComparisonViewId;
  onViewChange: (view: SeriesComparisonViewId) => void;
}) {
  return (
    <TabsRoot
      className="grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      value={activeView}
      onValueChange={(value) => {
        if (typeof value === "string" && isSeriesComparisonViewId(value)) {
          onViewChange(value);
        }
      }}
    >
      <TabsList aria-label="分析サブページ" className="flex min-w-0 flex-wrap gap-2">
        {perspectiveItems.map((item) => (
          <TabsTab
            className={cn(
              "inline-flex min-h-10 min-w-0 items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-semibold transition-colors",
              item.id === activeView
                ? "border-[var(--color-action)]/60 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]"
                : "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]",
            )}
            key={item.id}
            value={item.id}
          >
            <span>{item.label}</span>
          </TabsTab>
        ))}
      </TabsList>
      <p className="text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
        {analysisViewFor(activeView).description}
      </p>
    </TabsRoot>
  );
}

function SectionJumpLinks({ items }: { items: AnalysisViewDefinition["sections"] }) {
  if (items.length <= 1) {
    return null;
  }
  return (
    <nav aria-label="このサブページの観点" className="min-w-0">
      <div className="flex min-w-0 flex-wrap gap-2">
        {items.map((item) => (
          <a
            className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]"
            href={`#${item.id}`}
            key={item.id}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
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

function RecentFormMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const recentByMember = recentFormMap(response);
  return (
    <MetricSection
      description="直近8戦の調子指標と、全試合の順位推移です。3戦未満は参考です。"
      icon={<Activity className="size-5" />}
      title="直近の調子"
      id="metric-recent-form"
    >
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          直近順位ストリップ
        </h3>
        <RecentRankStrip entries={recentRankStrips(response)} players={players} />
      </div>
      <PlayerMetricGrid metricsByMember={metricsMap(response)} players={players}>
        {(player) => {
          const form = recentByMember.get(player.memberId);
          return (
            <>
              <div className="flex justify-end">
                <StatusBadge status={form?.status} />
              </div>
              <MetricRow
                label="平均順位"
                value={`${formatDecimal(form?.averageRank)}、${form?.targetCount ?? 0}戦`}
              />
              <MetricRow label="入賞率" value={formatPercent(form?.podiumRate)} />
              <MetricRow label="連勝" value={`${form?.winStreak ?? 0}戦`} />
              <MetricRow label="連続入賞" value={`${form?.podiumStreak ?? 0}戦`} />
              <MetricRow label="連続下位" value={`${form?.lowerHalfStreak ?? 0}戦`} />
            </>
          );
        }}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

type MomentumSwitchRate = MomentumSwitchEntry[MomentumSwitchRateKey];
type MomentumSwitchTransitionRow = NonNullable<MomentumSwitchEntry["transitionRows"]>[number];

function MomentumSwitchMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const switchByMember = momentumSwitchMap(response);
  return (
    <MetricSection
      description="前戦の順位から次戦の順位へどう動いたかを見ます。条件別率は8件未満なら参考です。"
      icon={<RefreshCw className="size-5" />}
      title="切り替え力"
      id="metric-momentum-switch"
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {players.map((player, index) => {
          const entry = switchByMember.get(player.memberId);
          return (
            <div
              className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
              key={player.memberId}
              style={{ borderTopColor: playerColor(index), borderTopWidth: 3 }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: playerColor(index) }}
                />
                <p className="min-w-0 text-sm font-semibold break-words text-[var(--color-text-primary)]">
                  {player.displayName}
                </p>
              </div>
              <div className="mt-3 grid gap-2">
                <div className="flex justify-end text-xs font-medium text-[var(--color-text-secondary)]">
                  {entry?.transitionCount ?? 0}遷移
                </div>
                <MomentumSwitchRateRow
                  kind="afterLower"
                  label="下位後入賞率"
                  rate={entry?.afterLower}
                />
                <MomentumSwitchRateRow
                  kind="afterFourth"
                  label="4位後入賞率"
                  rate={entry?.afterFourth}
                />
                <MomentumSwitchRateRow
                  kind="afterPodium"
                  label="入賞後下位率"
                  rate={entry?.afterPodium}
                />
              </div>
            </div>
          );
        })}
      </div>
      <MomentumTransitionMatrices entriesByMember={switchByMember} players={players} />
    </MetricSection>
  );
}

function MomentumSwitchRateRow({
  kind,
  label,
  rate,
}: {
  kind: MomentumSwitchRateKey;
  label: string;
  rate: MomentumSwitchRate | undefined;
}) {
  const emphasis = momentumSwitchEmphasis(kind, rate?.deltaFromBaseline, rate?.status);
  return (
    <MetricRow
      emphasis={emphasis}
      help={momentumSwitchHelp(kind)}
      label={label}
      status={rate?.status}
      value={
        <span className="inline-flex flex-col items-end gap-0.5">
          <span>
            {formatCountRate({
              count: rate?.successCount,
              rate: rate?.rate,
              targetCount: rate?.targetCount,
            })}
          </span>
          <span
            className={cn("text-[11px] font-medium leading-4", emphasisTextClass(emphasis?.kind))}
          >
            差 {formatSignedPercentPoint(rate?.deltaFromBaseline)}
          </span>
        </span>
      }
    />
  );
}

function momentumSwitchHelp(kind: MomentumSwitchRateKey): ReactNode {
  switch (kind) {
    case "afterFourth":
      return "前戦4位の次戦で1位か2位に入った割合です。差は本人全体の入賞率との差です。";
    case "afterPodium":
      return "前戦1位か2位の次戦で3位か4位になった割合です。差は本人全体の下位率との差です。";
    default:
      return "前戦3位か4位の次戦で1位か2位に入った割合です。差は本人全体の入賞率との差です。";
  }
}

function MomentumTransitionMatrices({
  entriesByMember,
  players,
}: {
  entriesByMember: Map<string, MomentumSwitchEntry>;
  players: Player[];
}) {
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">順位遷移</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {players.map((player, index) => (
          <MomentumTransitionMatrix
            entry={entriesByMember.get(player.memberId)}
            index={index}
            key={player.memberId}
            player={player}
          />
        ))}
      </div>
    </div>
  );
}

function MomentumTransitionMatrix({
  entry,
  index,
  player,
}: {
  entry: MomentumSwitchEntry | undefined;
  index: number;
  player: Player;
}) {
  const rows = [1, 2, 3, 4].map((previousRank) => momentumTransitionRow(entry, previousRank));
  return (
    <div
      className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
      style={{ borderTopColor: playerColor(index), borderTopWidth: 3 }}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 text-sm font-semibold break-words text-[var(--color-text-primary)]">
          {player.displayName}
        </span>
        <span className="shrink-0 text-xs font-medium text-[var(--color-text-secondary)]">
          {entry?.transitionCount ?? 0}遷移
        </span>
      </div>
      <div className="mt-3 overflow-x-auto pb-1">
        <div
          aria-label={`${player.displayName}の順位遷移`}
          className="grid min-w-[17rem] gap-1"
          style={{ gridTemplateColumns: "3.5rem repeat(4, minmax(2.8rem, 1fr))" }}
        >
          <div aria-hidden="true" />
          {[1, 2, 3, 4].map((rank) => (
            <div
              className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-center text-[11px] font-semibold text-[var(--color-text-secondary)]"
              key={`next-${rank}`}
            >
              次{rank}位
            </div>
          ))}
          {rows.map((row) => (
            <MomentumTransitionMatrixRow key={row.previousRank} row={row} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MomentumTransitionMatrixRow({ row }: { row: MomentumSwitchTransitionRow }) {
  return (
    <div className="contents">
      <div className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1">
        <div className="text-xs font-semibold text-[var(--color-text-primary)]">
          前{row.previousRank}位
        </div>
        <div className="text-[10px] leading-4 text-[var(--color-text-secondary)]">
          {row.targetCount}件
        </div>
      </div>
      {[1, 2, 3, 4].map((nextRank) => {
        const cell = momentumTransitionCell(row, nextRank);
        return (
          <div
            className={cn(
              "rounded-[var(--radius-xs)] border px-1.5 py-1 text-center tabular-nums",
              momentumTransitionCellClass(cell.count, cell.rate),
            )}
            key={`cell-${row.previousRank}-${nextRank}`}
          >
            <div className="text-sm font-semibold">{cell.count}</div>
            <div className="text-[10px] leading-4">{formatPercent(cell.rate)}</div>
          </div>
        );
      })}
    </div>
  );
}

function momentumTransitionRow(
  entry: MomentumSwitchEntry | undefined,
  previousRank: number,
): MomentumSwitchTransitionRow {
  return (
    (entry?.transitionRows ?? []).find((row) => row.previousRank === previousRank) ?? {
      cells: [1, 2, 3, 4].map((nextRank) => ({ count: 0, nextRank })),
      previousRank,
      status: "no_target",
      targetCount: 0,
    }
  );
}

function momentumTransitionCell(row: MomentumSwitchTransitionRow, nextRank: number) {
  return (
    (row.cells ?? []).find((cell) => cell.nextRank === nextRank) ?? {
      count: 0,
      nextRank,
    }
  );
}

function momentumTransitionCellClass(count: number, rate: number | null | undefined): string {
  if (count <= 0) {
    return "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]";
  }
  if (typeof rate === "number" && Number.isFinite(rate) && rate >= 0.5) {
    return "border-[var(--color-action)]/45 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]";
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

type AssetStyleEvidenceItem = {
  emphasis?: MetricEmphasis | undefined;
  help?: ReactNode;
  key: string;
  label: string;
  value: ReactNode;
};

function assetStyleEvidence(
  profile: AssetStyleProfileEntry,
  thresholds: SeriesComparisonResponse["assetStyleProfiles"],
): AssetStyleEvidenceItem[] {
  const metrics = profile.metrics;
  const evidence = { kind: "evidence", label: "根拠" } as const satisfies MetricEmphasis;
  const risk = { kind: "risk", label: "注意" } as const satisfies MetricEmphasis;
  const strength = { kind: "strength", label: "強み" } as const satisfies MetricEmphasis;
  const highAsset = {
    emphasis: strength,
    help: `全員合算の上位10%ライン（${formatMoney(thresholds.highAssetThreshold)}以上）に入った試合です。`,
    key: "high-assets",
    label: "高資産帯",
    value: formatCountRate({
      count: metrics.highAssetCount,
      rate: metrics.highAssetRate,
      targetCount: profile.targetCount,
    }),
  };
  const lowAsset = {
    help: `全員合算の下位10%ライン（${formatMoney(thresholds.lowAssetThreshold)}以下）に入った試合です。`,
    key: "low-assets",
    label: "低資産帯",
    value: formatCountRate({
      count: metrics.lowAssetCount,
      rate: metrics.lowAssetRate,
      targetCount: profile.targetCount,
    }),
  };
  const lowAssetAvoided = {
    ...lowAsset,
    emphasis: strength,
    help: `${lowAsset.help} 少ないほど、下振れを避けて総資産を積み上げている根拠として扱います。`,
    key: "low-assets-avoided",
    label: "低資産帯少なめ",
  };
  const lowAssetRisk = {
    ...lowAsset,
    emphasis: risk,
    help: `${lowAsset.help} 多いほど、資産を取りに行く代わりに下振れも出ている根拠として扱います。`,
    key: "low-assets-risk",
  };
  const blowoutWin = {
    help: `勝利時の1位-2位差が、選択範囲の勝利差75パーセンタイル（${formatMoney(thresholds.blowoutWinThreshold)}）以上だった試合です。`,
    emphasis: strength,
    key: "blowout-win",
    label: "大差勝ち",
    value: `${metrics.blowoutWinCount}戦`,
  };
  const fewBlowoutWins = {
    ...blowoutWin,
    emphasis: evidence,
    help: `${blowoutWin.help} 少ない場合は、大差より接戦で回収する型の根拠として扱います。`,
    key: "few-blowout-win",
    label: "大差勝ち少なめ",
  };
  const closeWin = {
    emphasis: strength,
    help: "勝った試合における1位と2位の総資産差の中央値です。小さいほど接戦で勝ち切っています。",
    key: "win-margin",
    label: "勝利時の差",
    value: formatMoney(metrics.winMedianMargin),
  };
  const lowerGap = {
    emphasis: risk,
    help: "3・4位だった試合における、1位との総資産差の中央値です。大きいほど下位時の負け幅が重く、注意根拠として扱います。",
    key: "lower-gap",
    label: "下位時の差",
    value: formatMoney(metrics.lowerHalfMedianGap),
  };
  const winAssets = {
    emphasis: strength,
    help: "勝った試合における総資産の中央値です。高いほど、総資産を取り切って勝つ根拠として扱います。",
    key: "win-assets",
    label: "勝利時資産",
    value: formatMoney(metrics.winMedianAssets),
  };
  const secondGap = {
    emphasis: evidence,
    help: "2位だった試合における、1位との総資産差の中央値です。小さいほど、上位を追走している根拠として扱います。",
    key: "second-gap",
    label: "2位時の差",
    value: formatMoney(metrics.secondMedianGap),
  };
  const medianAssets = {
    key: "median-assets",
    label: "中央値",
    value: formatMoney(metrics.medianAssets),
  };
  const spread = {
    key: "spread",
    label: "高め-低め",
    value: formatMoney(metrics.p90P10Spread),
  };

  switch (profile.primaryKind) {
    case "asset_explosion":
      return [highAsset, winAssets, blowoutWin];
    case "steady_accumulator":
      return [lowAssetAvoided, medianAssets, spread];
    case "high_risk_breakthrough":
      return [highAsset, lowAssetRisk, lowerGap];
    case "close_collector":
      return [closeWin, fewBlowoutWins, secondGap];
    case "upper_chaser":
      return [secondGap, closeWin, highAsset];
    default:
      return [highAsset, lowAsset, spread];
  }
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
        <MiniFact label="4人中央値との差" value={formatPercentPointDelta(rateDelta)} />
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

function formatPercentPointDelta(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}pt`;
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

type CardShopDestinationEntry = NonNullable<
  SeriesComparisonResponse["cardShopDestination"]["entries"]
>[number];
type CardShopDestinationQuadrant = NonNullable<CardShopDestinationEntry["quadrants"]>[number];

const cardShopDestinationDefinitions = [
  {
    color: "var(--color-success)",
    kind: "destination_with_shop",
    label: "到着あり × 売り場あり",
  },
  {
    color: "var(--color-action)",
    kind: "destination_without_shop",
    label: "到着あり × 売り場なし",
  },
  {
    color: "var(--color-warning)",
    kind: "no_destination_with_shop",
    label: "到着なし × 売り場あり",
  },
  {
    color: "var(--color-tray-incident)",
    kind: "no_destination_without_shop",
    label: "到着なし × 売り場なし",
  },
] as const;

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

function cardShopQuadrantsByKind(
  entry: CardShopDestinationEntry | undefined,
): Map<CardShopDestinationQuadrant["kind"], CardShopDestinationQuadrant> {
  return new Map((entry?.quadrants ?? []).map((quadrant) => [quadrant.kind, quadrant]));
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

function rankOutcomeColor(rank: number): string {
  if (rank === 1) return "var(--color-rank-1)";
  if (rank === 2) return "var(--color-rank-2)";
  if (rank === 3) return "var(--color-rank-3)";
  return "var(--color-rank-4)";
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
        aria-label={`${activeDefinition.label}の内容`}
        id={`series-comparison-view-${activeDefinition.id}`}
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
