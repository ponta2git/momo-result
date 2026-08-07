import type { MatchPerformanceContextRow } from "@/shared/domain/matchPerformanceContext";
import { formatManYen } from "@/shared/lib/formatters";
import { cn } from "@/shared/ui/cn";
import { RankBadge } from "@/shared/ui/rank/RankBadge";
import { colorMix, rankColor } from "@/shared/ui/rank/rankPresentation";

export type MatchResultLedgerRow = MatchPerformanceContextRow & {
  displayName: string;
};

export type MatchResultLedgerContextStatus = "loading" | "ready" | "unavailable";

export function MatchResultLedger({
  ariaLabel = "試合の順位と成績",
  className,
  contextStatus,
  rows,
}: {
  ariaLabel?: string;
  className?: string;
  contextStatus: MatchResultLedgerContextStatus;
  rows: MatchResultLedgerRow[];
}) {
  return (
    <ol
      aria-label={ariaLabel}
      className={cn(
        "momo-enter grid overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]",
        className,
      )}
    >
      {rows.map((row) => (
        <li
          key={row.memberId}
          className="grid min-w-0 gap-3 border-b border-[var(--color-border)] p-3 last:border-b-0 sm:grid-cols-[4rem_minmax(9rem,16rem)_minmax(10rem,12rem)] sm:items-center sm:justify-center"
          style={{ backgroundColor: colorMix(rankColor(row.rank), 0.05) }}
        >
          <div className="flex items-center gap-3 sm:block">
            <RankBadge rank={row.rank} size="md" />
            <span className="font-semibold text-[var(--color-text-primary)] sm:hidden">
              {row.displayName}
            </span>
          </div>

          <div className="min-w-0">
            <p className="hidden truncate font-semibold text-[var(--color-text-primary)] sm:block">
              {row.displayName}
            </p>
            <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
              <span>
                物件収益{" "}
                <strong className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                  {formatManYen(row.revenueManYen)}
                </strong>
              </span>
              <span className="tabular-nums">収益順位 {formatOrdinal(row.revenueRank)}</span>
              <span className="tabular-nums">
                物件収益比率{" "}
                {row.revenueAssetRate === undefined
                  ? "対象外"
                  : formatRevenueAssetRate(row.revenueAssetRate)}
              </span>
            </div>
          </div>

          <div className="min-w-0 sm:text-right">
            <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">総資産</p>
            <p className="mt-0.5 text-xl font-semibold text-[var(--color-text-primary)] tabular-nums">
              {formatManYen(row.totalAssetsManYen)}
            </p>
          </div>

          <div className="col-span-full flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-2 text-xs">
            <span className="font-medium text-[var(--color-text-secondary)]">通算平均順位</span>
            <AverageRankChange contextStatus={contextStatus} row={row} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function AverageRankChange({
  contextStatus,
  row,
}: {
  contextStatus: MatchResultLedgerContextStatus;
  row: MatchResultLedgerRow;
}) {
  if (contextStatus === "loading") {
    return <span className="text-[var(--color-text-secondary)]">比較データを読み込み中</span>;
  }
  if (
    contextStatus === "unavailable" ||
    row.trend === "unavailable" ||
    row.cumulativeAverageAfter === undefined
  ) {
    return <span className="text-[var(--color-text-secondary)]">比較データなし</span>;
  }

  const transition =
    row.cumulativeAverageBefore === undefined
      ? formatAverageRank(row.cumulativeAverageAfter)
      : `${formatAverageRank(row.cumulativeAverageBefore)} → ${formatAverageRank(
          row.cumulativeAverageAfter,
        )}`;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2 text-right">
      <strong className="font-semibold text-[var(--color-text-primary)] tabular-nums">
        {transition}
      </strong>
      <span
        className={cn(
          "rounded-[var(--radius-xs)] border px-2 py-0.5 font-semibold",
          trendTone(row.trend),
        )}
      >
        {trendLabel(row)}
      </span>
    </span>
  );
}

function formatAverageRank(value: number): string {
  return value.toFixed(2);
}

function formatOrdinal(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}位`;
}

function formatRevenueAssetRate(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    style: "percent",
  }).format(value);
}

function trendLabel(row: MatchResultLedgerRow): string {
  if (row.trend === "firstMatch") {
    return "初戦";
  }
  if (row.trend === "unchanged" || row.cumulativeAverageDelta === undefined) {
    return "維持";
  }
  return `${Math.abs(row.cumulativeAverageDelta).toFixed(2)}${
    row.trend === "improved" ? "改善" : "後退"
  }`;
}

function trendTone(trend: MatchResultLedgerRow["trend"]): string {
  if (trend === "improved") {
    return "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-success)]";
  }
  if (trend === "declined") {
    return "border-[var(--color-danger)]/35 bg-[var(--color-danger)]/8 text-[var(--color-danger)]";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]";
}
