import { ArrowUpRight, Search } from "lucide-react";

import {
  focusedMetricLabelClass,
  focusedMetricRingClass,
} from "@/features/seriesComparison/charts/chartPresentation";
import {
  playerName,
  formatDateTime,
  formatManYen,
  timelineFlagLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { compactBadgeClass, compactBadgeToneClass } from "@/shared/ui/status/badgeRecipes";
import { contentText } from "@/shared/ui/typography";

const flagOrder = ["close_finish", "asset_blowout", "ginji_storm", "revenue_top_no_win"];

export function MatchDigestStrip({
  focusedItemIds,
  onFocusMatch,
  players,
  digest,
}: {
  focusedItemIds: readonly string[];
  onFocusMatch: (matchId: string) => void;
  players: SeriesComparisonAggregate["players"];
  digest: SeriesComparisonAggregate["matchDigest"];
}) {
  return (
    <div className="grid gap-4">
      <FactList
        ariaLabel="荒れ方ごとの試合数"
        columns={4}
        items={flagOrder.map((flag) => ({
          id: flag,
          label: timelineFlagLabel(flag),
          value: `${digest.flagCounts[flag] ?? 0}戦`,
        }))}
        layout="plain"
      />
      {digest.recent.length === 0 ? (
        <p className={cn(contentText.body, "py-3")}>対象試合はありません。</p>
      ) : (
        <div className="[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent] overflow-x-auto pb-1">
          <div className="flex min-w-max gap-4">
            {digest.recent.toReversed().map((match) => {
              const focused = focusedItemIds.includes(match.itemId);
              return (
                <article
                  className={cn(
                    "w-52 shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4",
                    focused && focusedMetricRingClass,
                  )}
                  data-focused-metric={focused ? "true" : undefined}
                  key={match.itemId}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <SeriesAnalysisMatchLink
                        ariaLabel={`${formatSeriesMatchIndex(match.matchIndex)}の試合結果を見る`}
                        matchId={match.matchId}
                        presentation="inline"
                      >
                        {formatSeriesMatchIndex(match.matchIndex)}
                        <ArrowUpRight aria-hidden="true" className="size-3.5" />
                      </SeriesAnalysisMatchLink>
                      <p className={cn(contentText.compactPrimary, "mt-0.5 break-words")}>
                        {match.winnerMemberId
                          ? playerName(players, match.winnerMemberId)
                          : "勝者不明"}
                      </p>
                    </div>
                    <SeriesAnalysisQualityAdvisory status={match.qualityStatus} />
                  </div>
                  <p className={cn(contentText.supporting, "mt-1")}>
                    {formatDateTime(match.playedAt)}
                  </p>
                  {focused ? <p className={cn(focusedMetricLabelClass, "mt-1")}>選択中</p> : null}
                  <div className="mt-2">
                    <FactList
                      ariaLabel={`${formatSeriesMatchIndex(match.matchIndex)}の資産差と銀次`}
                      items={[
                        {
                          id: "first-second",
                          label: "1位–2位差",
                          value: formatManYen(match.assetGapFirstToSecond),
                        },
                        {
                          id: "first-last",
                          label: "1位–4位差",
                          value: formatManYen(match.assetGapFirstToLast),
                        },
                        {
                          id: "ginji",
                          label: "スリの銀次",
                          value: `${match.totalGinjiCount}回`,
                        },
                      ]}
                      layout="plain"
                    />
                  </div>
                  <div className="mt-2 flex min-h-6 flex-wrap gap-2">
                    {match.flags.length === 0 ? (
                      <span className={contentText.supporting}>大きな特徴なし</span>
                    ) : (
                      match.flags.map((flag) => (
                        <span
                          className={cn(compactBadgeClass, compactBadgeToneClass.neutral)}
                          key={flag}
                        >
                          {timelineFlagLabel(flag)}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="mt-2">
                    <Button
                      icon={<Search aria-hidden="true" />}
                      size="sm"
                      variant={focused ? "secondary" : "quiet"}
                      onClick={() => onFocusMatch(match.matchId)}
                    >
                      {focused ? "選択中" : "比較する"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
