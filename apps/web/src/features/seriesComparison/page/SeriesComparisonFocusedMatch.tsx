import { ArrowUpRight, X } from "lucide-react";

import { playerNameMap } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";

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
  const resultSummary = points
    .map((point) => `${point.rank}位 ${names.get(point.memberId) ?? "名前不明"}`)
    .join(" / ");
  const included = matchIndex !== undefined;

  return (
    <section
      aria-label="選択中の試合"
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-action)]/45 bg-[var(--color-surface-selected)] p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
          試合結果から表示
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-[var(--color-text-primary)]">
          {included
            ? `${matchIndex}戦目${playedAt ? `・${playedAt}` : ""}`
            : "この比較条件に対象試合が含まれていません"}
        </h2>
        <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
          {included
            ? resultSummary || "順位データを確認できません。"
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
    </section>
  );
}
