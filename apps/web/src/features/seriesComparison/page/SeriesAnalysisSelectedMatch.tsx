import { X } from "lucide-react";

import {
  formatDateTime,
  matchFeatureLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import type { SeriesAnalysisMatchContextV2 } from "@/shared/api/seriesAnalysis";
import { formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { matchPerformanceContextFromArtifact } from "@/shared/domain/matchPerformanceContext";
import { Button } from "@/shared/ui/actions/Button";
import { MatchResultLedger } from "@/shared/ui/data/MatchResultLedger";

export function SeriesAnalysisSelectedMatch({
  context,
  onClear,
}: {
  context: SeriesAnalysisMatchContextV2;
  onClear: () => void;
}) {
  const performance = matchPerformanceContextFromArtifact(context);
  if (!context.match || !performance) return null;
  const rows = performance.rows.map((row) =>
    Object.assign({}, row, {
      displayName:
        context.match?.players.find((player) => player.memberId === row.memberId)?.displayName ??
        "プレーヤー名未取得",
    }),
  );
  return (
    <section
      aria-label="選択中の試合"
      className="grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-[var(--color-action)]/55 bg-[var(--color-surface-selected)] p-3"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--color-action)]">選択中の試合</p>
          <h2 className="mt-0.5 text-base font-semibold text-[var(--color-text-primary)]">
            <SeriesAnalysisMatchLink
              ariaLabel={`${formatSeriesMatchIndex(context.match.matchIndex)}の試合結果を見る`}
              matchId={context.matchId}
              presentation="text"
            >
              {formatSeriesMatchIndex(context.match.matchIndex)}・
              {formatDateTime(context.match.playedAt)}
            </SeriesAnalysisMatchLink>
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
            対応する図表の位置を「この試合」として示しています。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button icon={<X aria-hidden="true" />} size="sm" variant="quiet" onClick={onClear}>
            この試合の選択を解除
          </Button>
        </div>
      </div>
      {context.match.features.length > 0 ? (
        <ul aria-label="この試合の注目点" className="flex flex-wrap gap-2">
          {context.match.features.map((feature) => (
            <li
              className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
              key={`${feature.priority}:${feature.featureCode}`}
            >
              {matchFeatureLabel(feature.featureCode)}
            </li>
          ))}
        </ul>
      ) : null}
      <MatchResultLedger ariaLabel="選択中の試合の順位と成績" contextStatus="ready" rows={rows} />
    </section>
  );
}
