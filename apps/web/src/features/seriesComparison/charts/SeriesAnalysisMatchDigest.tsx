import { ArrowUpRight, Search } from "lucide-react";

import {
  formatDateTime,
  formatManYen,
  timelineFlagLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import { playerName } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { Button } from "@/shared/ui/actions/Button";

const flagOrder = ["close_finish", "asset_blowout", "ginji_storm", "revenue_top_no_win"];

export function MatchDigestStrip({
  focusedItemIds,
  onFocusMatch,
  response,
}: {
  focusedItemIds: readonly string[];
  onFocusMatch: (matchId: string) => void;
  response: SeriesComparisonAggregateV3;
}) {
  return (
    <div className="grid gap-3">
      <dl className="grid divide-y divide-[var(--color-border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        {flagOrder.map((flag) => (
          <div className="px-3 py-2" key={flag}>
            <dt className="text-xs text-[var(--color-text-secondary)]">
              {timelineFlagLabel(flag)}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums">
              {response.matchDigest.flagCounts[flag] ?? 0}戦
            </dd>
          </div>
        ))}
      </dl>
      {response.matchDigest.recent.length === 0 ? (
        <p className="py-3 text-sm text-[var(--color-text-secondary)]">対象試合はありません。</p>
      ) : (
        <div className="[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent] overflow-x-auto pb-1">
          <div className="flex min-w-max gap-3">
            {response.matchDigest.recent.toReversed().map((match) => {
              const focused = focusedItemIds.includes(match.itemId);
              return (
                <article
                  className={`w-52 shrink-0 rounded-[var(--radius-sm)] border bg-[var(--color-surface)] p-3 ${focused ? "momo-enter border-[var(--color-action)] ring-2 ring-[var(--color-action)]/25" : "border-[var(--color-border)]"}`}
                  data-focused-metric={focused ? "true" : undefined}
                  key={match.itemId}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <SeriesAnalysisMatchLink
                        ariaLabel={`${formatSeriesMatchIndex(match.matchIndex)}の試合結果を見る`}
                        className="gap-1 text-xs"
                        matchId={match.matchId}
                      >
                        {formatSeriesMatchIndex(match.matchIndex)}
                        <ArrowUpRight aria-hidden="true" className="size-3.5" />
                      </SeriesAnalysisMatchLink>
                      <p className="mt-0.5 text-sm font-semibold break-words">
                        {match.winnerMemberId
                          ? playerName(response.players, match.winnerMemberId)
                          : "勝者不明"}
                      </p>
                    </div>
                    <SeriesAnalysisQualityAdvisory status={match.qualityStatus} />
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                    {formatDateTime(match.playedAt)}
                  </p>
                  {focused ? (
                    <p className="mt-1 text-[11px] font-semibold text-[var(--color-action)]">
                      選択中
                    </p>
                  ) : null}
                  <dl className="mt-2 grid gap-1 text-xs">
                    <DigestValue
                      label="1位–2位差"
                      value={formatManYen(match.assetGapFirstToSecond)}
                    />
                    <DigestValue
                      label="1位–4位差"
                      value={formatManYen(match.assetGapFirstToLast)}
                    />
                    <DigestValue label="スリの銀次" value={`${match.totalGinjiCount}回`} />
                  </dl>
                  <div className="mt-2 flex min-h-6 flex-wrap gap-1">
                    {match.flags.length === 0 ? (
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        大きな特徴なし
                      </span>
                    ) : (
                      match.flags.map((flag) => (
                        <span
                          className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]"
                          key={flag}
                        >
                          {timelineFlagLabel(flag)}
                        </span>
                      ))
                    )}
                  </div>
                  <Button
                    className="mt-2 w-full"
                    icon={<Search aria-hidden="true" className="size-4" />}
                    size="sm"
                    variant={focused ? "secondary" : "quiet"}
                    onClick={() => onFocusMatch(match.matchId)}
                  >
                    {focused ? "選択中" : "比較する"}
                  </Button>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DigestValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
