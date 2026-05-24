import { MessageSquareText, Trophy } from "lucide-react";

import { formatMatchNo } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

type MatchNightRecapProps = {
  incompleteCount: number;
  items: MatchListItemView[];
  loading?: boolean;
};

type WinnerCount = {
  count: number;
  name: string;
};

function winnerCounts(items: MatchListItemView[]): WinnerCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const winner = item.ranks.find((rank) => rank.rank === 1);
    if (!winner) {
      continue;
    }
    counts.set(winner.displayName, (counts.get(winner.displayName) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ count, name })).toSorted((left, right) => {
    const countDiff = right.count - left.count;
    return countDiff === 0 ? left.name.localeCompare(right.name, "ja") : countDiff;
  });
}

function latestConfirmedItem(items: MatchListItemView[]): MatchListItemView | undefined {
  return items.toSorted((left, right) => {
    const numberDiff = (right.matchNoInEvent ?? 0) - (left.matchNoInEvent ?? 0);
    if (numberDiff !== 0) {
      return numberDiff;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  })[0];
}

function winnerSummary(counts: WinnerCount[]): string {
  const top = counts[0];
  if (!top) {
    return "勝者の記録待ち";
  }
  const tiedNames = counts.filter((item) => item.count === top.count).map((item) => item.name);
  return tiedNames.length === 1
    ? `${top.name} ${top.count}勝`
    : `${tiedNames.join(" / ")} ${top.count}勝ずつ`;
}

function latestSummary(item: MatchListItemView | undefined): string {
  if (!item) {
    return "最新の確定試合待ち";
  }
  const winner = item.ranks.find((rank) => rank.rank === 1);
  const matchNo = formatMatchNo(item.matchNoInEvent);
  return winner ? `${matchNo}は${winner.displayName}が1位` : `${matchNo}を確定済み`;
}

export function MatchNightRecap({ incompleteCount, items, loading = false }: MatchNightRecapProps) {
  if (loading) {
    return (
      <section
        aria-label="開催の振り返り"
        className="grid min-h-[7.5rem] gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:grid-cols-3"
      >
        <Skeleton className="min-h-20" />
        <Skeleton className="min-h-20" />
        <Skeleton className="min-h-20" />
      </section>
    );
  }

  const confirmedItems = items.filter((item) => item.status === "confirmed");
  if (confirmedItems.length === 0 && incompleteCount === 0) {
    return null;
  }

  const counts = winnerCounts(confirmedItems);
  const latest = latestConfirmedItem(confirmedItems);
  const completeLabel = incompleteCount === 0 ? "全試合の確認完了" : `${incompleteCount}件が未完了`;

  return (
    <section
      aria-label="開催の振り返り"
      className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:grid-cols-[1.1fr_1fr_1fr]"
    >
      <div className="flex min-h-20 items-center gap-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] px-3 py-2">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--color-action)]/30 bg-[var(--color-action)]/10 text-[var(--color-action)]"
        >
          <MessageSquareText className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">開催の振り返り</p>
          <p className="mt-1 text-sm font-semibold text-pretty text-[var(--color-text-primary)]">
            {confirmedItems.length}試合確定、{completeLabel}
          </p>
        </div>
      </div>
      <div className="flex min-h-20 items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--color-warning)]/60 bg-[var(--color-warning)]/18 text-[var(--color-text-primary)]"
        >
          <Trophy className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">勝ち頭</p>
          <p className="mt-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {winnerSummary(counts)}
          </p>
        </div>
      </div>
      <div className="flex min-h-20 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">最新の話題</p>
          <p className="mt-1 text-sm font-semibold text-pretty text-[var(--color-text-primary)]">
            {latestSummary(latest)}
          </p>
        </div>
      </div>
    </section>
  );
}
