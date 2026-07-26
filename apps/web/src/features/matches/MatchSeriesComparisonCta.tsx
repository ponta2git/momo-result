import { seriesComparisonHrefForMatch } from "@/features/matches/matchDetailViewModel";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { LinkButton } from "@/shared/ui/actions/LinkButton";

export function MatchSeriesComparisonCta({
  match,
}: {
  match: Pick<MatchDetailResponse, "gameTitleId" | "mapMasterId" | "matchId" | "seasonMasterId">;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">
          この1戦を過去の戦績と比べる
        </p>
        <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
          同じ作品・シーズン・マップの推移を開き、この試合を目印として表示します。
        </p>
      </div>
      <LinkButton className="shrink-0" to={seriesComparisonHrefForMatch(match)} variant="secondary">
        戦績の中で見る
      </LinkButton>
    </div>
  );
}
