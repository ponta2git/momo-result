import { ArrowUpRight, X } from "lucide-react";
import { useLocation } from "react-router-dom";

import {
  formatDateTime,
  matchFeatureLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesAnalysisMatchContextV2 } from "@/shared/api/seriesAnalysis";
import { matchPerformanceContextFromArtifact } from "@/shared/domain/matchPerformanceContext";
import { currentInternalLocation, withReturnTo } from "@/shared/navigation/returnTo";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { MatchResultLedger } from "@/shared/ui/data/MatchResultLedger";

export function SeriesAnalysisSelectedMatch({
  context,
  onClear,
}: {
  context: SeriesAnalysisMatchContextV2;
  onClear: () => void;
}) {
  const location = useLocation();
  const performance = matchPerformanceContextFromArtifact(context);
  if (!context.match || !performance) return null;
  const rows = performance.rows.map((row) =>
    Object.assign({}, row, {
      displayName:
        context.match?.players.find((player) => player.memberId === row.memberId)?.displayName ??
        "名前不明",
    }),
  );
  const returnTo = currentInternalLocation(location);

  return (
    <section
      aria-label="選択中の試合"
      className="momo-enter grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-[var(--color-action)]/55 bg-[var(--color-surface-selected)] p-3 motion-reduce:animate-none"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[var(--color-action)]">選択中の試合</p>
          <h2 className="mt-0.5 text-base font-semibold text-[var(--color-text-primary)]">
            第{context.match.matchIndex}戦・{formatDateTime(context.match.playedAt)}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
            対応する図表の位置を「この試合」として示しています。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <LinkButton
            icon={<ArrowUpRight aria-hidden="true" className="size-4" />}
            size="sm"
            to={withReturnTo(`/matches/${encodeURIComponent(context.matchId)}`, returnTo)}
            variant="secondary"
          >
            この試合の結果
          </LinkButton>
          <Button
            icon={<X aria-hidden="true" className="size-4" />}
            size="sm"
            variant="quiet"
            onClick={onClear}
          >
            選択解除
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
