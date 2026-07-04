import { Store } from "lucide-react";

import {
  MetricRow,
  PlayerMetricGrid,
  StatusBadge,
} from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/metrics/SeriesComparisonMetricSection";
import { OutcomeDetails } from "@/features/seriesComparison/metrics/SeriesComparisonSectionPrimitives";
import type {
  CardShopDestinationEntry,
  CardShopDestinationQuadrant,
  Player,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import {
  cardShopDestinationDefinitions,
  cardShopQuadrantsByKind,
  formatCountRate,
  formatDecimal,
  formatMoney,
  formatPercent,
  metricsMap,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { cn } from "@/shared/ui/cn";

export function CardShopDestinationMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const entries = response.cardShopDestination.entries ?? [];
  const entriesByMember = new Map(entries.map((entry) => [entry.memberId, entry]));
  return (
    <MetricSection
      description="目的地到着とカード売り場停車が、同じ試合にどう出ているかを見ます。行動順はDBにないため、売り場停車が寄り道か、資金・カード準備か、到着に効いたかは断定しません。"
      Icon={Store}
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
