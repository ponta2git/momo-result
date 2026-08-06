import { ArrowUpRight, Clock3, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { playerColor } from "@/features/seriesComparison/charts/SeriesComparisonPlayerVisuals";
import { StatusBadge } from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/metrics/SeriesComparisonMetricSection";
import type {
  MatchNoBreakdown,
  Player,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import {
  formatDecimal,
  formatMoney,
  formatPercent,
  playerNameMap,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import {
  qualitySummary,
  timelineFlagLabel,
} from "@/features/seriesComparison/model/seriesComparisonViewModel";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { Notice } from "@/shared/ui/feedback/Notice";

export function MatchDigestMetrics({
  focusMatchId,
  response,
}: {
  focusMatchId?: string | undefined;
  response: SeriesComparisonResponse;
}) {
  return (
    <MetricSection
      description="接戦、大差、スリの銀次多発、物件収益トップ未勝利が、選択範囲で何度起きたかを示します。"
      Icon={ShieldAlert}
      title="期間内の荒れ試合"
      id="metric-match-digest"
    >
      <MatchResultStrip focusMatchId={focusMatchId} response={response} />
    </MetricSection>
  );
}

function MatchResultStrip({
  focusMatchId,
  response,
}: {
  focusMatchId?: string | undefined;
  response: SeriesComparisonResponse;
}) {
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
                className={cn(
                  "w-44 shrink-0 rounded-[var(--radius-sm)] border bg-[var(--color-surface-subtle)] p-2.5",
                  point.matchId === focusMatchId
                    ? "momo-enter border-[var(--color-action)] ring-2 ring-[var(--color-action)]/25"
                    : "border-[var(--color-border)]",
                )}
                data-focused-match={point.matchId === focusMatchId || undefined}
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
                {point.matchId === focusMatchId ? (
                  <p className="mt-1 text-[11px] font-semibold text-[var(--color-action)]">
                    選択中
                  </p>
                ) : null}
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
                <Link
                  aria-label={`${point.matchIndex}戦目の試合結果を見る`}
                  className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[var(--color-action)] underline-offset-4 hover:underline"
                  to={`/matches/${encodeURIComponent(point.matchId)}`}
                >
                  試合結果を見る
                  <ArrowUpRight aria-hidden="true" className="size-3.5" />
                </Link>
              </article>
            ))}
          </div>
          {flaggedTimeline.length <
          timeline.filter((point) => (point.flags ?? []).length > 0).length ? (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              荒れ試合の内訳は、直近8件を対象にしています。
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function MatchNoInEventMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const breakdown = response.matchNoInEventBreakdown ?? [];
  const breakdownByNo = new Map(breakdown.map((item) => [item.matchNoInEvent, item]));
  const primaryBreakdown: MatchNoBreakdown[] = [1, 2, 3, 4].map(
    (matchNoInEvent) => breakdownByNo.get(matchNoInEvent) ?? { matchNoInEvent, playerRows: [] },
  );
  const extraBreakdown = breakdown.filter((item) => item.matchNoInEvent > 4);
  return (
    <MetricSection
      description="開催内の試合番号ごとの平均順位と入賞率から、長丁場での変化を示します。"
      Icon={Clock3}
      title="第n試合の傾向"
      id="metric-match-no"
    >
      <MatchNoTable breakdown={primaryBreakdown} players={players} />
      {extraBreakdown.length > 0 ? (
        <Disclosure
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]"
          panelClassName="border-t border-[var(--color-border)] p-3"
          summary="第5試合以降"
        >
          <MatchNoTable breakdown={extraBreakdown} players={players} />
        </Disclosure>
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

export function DataQualityNotice({ response }: { response: SeriesComparisonResponse }) {
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
