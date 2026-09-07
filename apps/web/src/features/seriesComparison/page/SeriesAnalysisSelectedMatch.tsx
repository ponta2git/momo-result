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
import { cn } from "@/shared/ui/cn";
import { MatchResultLedger } from "@/shared/ui/data/MatchResultLedger";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText } from "@/shared/ui/typography";

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
      className="grid min-w-0 gap-4 rounded-md border border-[var(--color-action)]/55 bg-[var(--color-surface-selected)] p-4"
    >
      <ContentWithActions
        actions={
          <Button icon={<X aria-hidden="true" />} size="sm" variant="quiet" onClick={onClear}>
            この試合の選択を解除
          </Button>
        }
      >
        <div className="min-w-0">
          <p className="font-plain text-xs text-[var(--color-action)]">選択中の試合</p>
          <h2 className={cn(contentText.heading, "mt-0.5")}>
            <SeriesAnalysisMatchLink
              ariaLabel={`${formatSeriesMatchIndex(context.match.matchIndex)}の試合結果を見る`}
              matchId={context.matchId}
              presentation="text"
            >
              {formatSeriesMatchIndex(context.match.matchIndex)}・
              {formatDateTime(context.match.playedAt)}
            </SeriesAnalysisMatchLink>
          </h2>
          <p className={cn(contentText.supporting, "mt-1")}>
            対応する図表の位置を「この試合」として示しています。
          </p>
        </div>
      </ContentWithActions>
      {context.match.features.length > 0 ? (
        <ul aria-label="この試合の注目点" className="flex flex-wrap gap-2">
          {context.match.features.map((feature) => (
            <li
              className="rounded-xs border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
              key={`${feature.priority}:${feature.featureCode}`}
            >
              {matchFeatureLabel(feature.featureCode)}
            </li>
          ))}
        </ul>
      ) : null}
      <MatchResultLedger
        ariaLabel="選択中の試合の順位と成績"
        contextStatus="ready"
        presentation="embedded"
        rows={rows}
      />
    </section>
  );
}
