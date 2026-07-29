import { ArrowUpRight, X } from "lucide-react";

import { playerNameMap } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { buildMatchPerformanceContext } from "@/shared/domain/matchPerformanceContext";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { MatchResultLedger } from "@/shared/ui/data/MatchResultLedger";

function formatFocusedMatchDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function SeriesComparisonFocusedMatch({
  focusMatchId,
  onClear,
  response,
}: {
  focusMatchId: string;
  onClear: () => void;
  response: SeriesComparisonResponse;
}) {
  const points = (response.matchPlayerPoints ?? [])
    .filter((point) => point.matchId === focusMatchId)
    .toSorted((left, right) => left.rank - right.rank);
  const timeline = (response.matchTimeline ?? []).find((point) => point.matchId === focusMatchId);
  const matchIndex = timeline?.matchIndex ?? points[0]?.matchIndex;
  const playedAt = formatFocusedMatchDate(timeline?.playedAt ?? points[0]?.playedAt);
  const names = playerNameMap(response.players ?? []);
  const performanceContext = buildMatchPerformanceContext({
    currentResults: points.map((point) => ({
      memberId: point.memberId,
      rank: point.rank,
      revenueManYen: point.revenue,
      totalAssetsManYen: point.totalAssets,
    })),
    matchId: focusMatchId,
    matchPlayerPoints: response.matchPlayerPoints,
  });
  const rows = performanceContext.rows.map((row) =>
    Object.assign({ displayName: names.get(row.memberId) ?? "名前不明" }, row),
  );
  const included = matchIndex !== undefined && rows.length > 0;

  return (
    <section
      aria-label="選択中の試合"
      className="momo-enter grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-[var(--color-action)]/55 bg-[var(--color-surface-selected)] p-3"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[var(--color-action)]">選択中の試合</p>
          <h2 className="mt-0.5 text-base font-semibold text-[var(--color-text-primary)]">
            {included
              ? `${matchIndex}戦目${playedAt ? `・${playedAt}` : ""}`
              : "この比較条件に対象試合が含まれていません"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
            {included
              ? "この試合の4人成績と、試合前後の通算平均順位です。対応するグラフや指標表では、位置を「この試合」で表示します。"
              : "条件を変更した可能性があります。試合結果を開くか、選択を解除してください。"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <LinkButton
            icon={<ArrowUpRight className="size-4" />}
            size="sm"
            to={`/matches/${encodeURIComponent(focusMatchId)}`}
            variant="secondary"
          >
            この試合の結果
          </LinkButton>
          <Button icon={<X className="size-4" />} size="sm" variant="quiet" onClick={onClear}>
            選択解除
          </Button>
        </div>
      </div>
      {included ? (
        <MatchResultLedger ariaLabel="選択中の試合の順位と成績" contextStatus="ready" rows={rows} />
      ) : null}
    </section>
  );
}
