import type { MatchPerformanceContextRow } from "@/shared/domain/matchPerformanceContext";
import { formatManYen } from "@/shared/lib/formatters";
import { cn } from "@/shared/ui/cn";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

type MatchResultLedgerRow = MatchPerformanceContextRow & {
  displayName: string;
};

type MatchResultLedgerContextStatus = "loading" | "ready" | "unavailable";
type MatchResultLedgerPresentation = "embedded" | "standalone";

export function MatchResultLedger({
  ariaLabel = "試合の順位と成績",
  contextStatus,
  presentation = "standalone",
  rows,
}: {
  ariaLabel?: string;
  contextStatus: MatchResultLedgerContextStatus;
  presentation?: MatchResultLedgerPresentation;
  rows: MatchResultLedgerRow[];
}) {
  const orderedRows = rows.toSorted((left, right) => left.rank - right.rank);

  return (
    <ol
      aria-label={ariaLabel}
      className={cn(
        "grid divide-y divide-[var(--color-border)] overflow-hidden border border-[var(--color-border-strong)] bg-[var(--color-surface)]",
        presentation === "embedded" ? "rounded-sm" : "rounded-md",
      )}
    >
      {orderedRows.map((row) => (
        <li
          key={row.memberId}
          className="grid min-w-0 gap-3 p-3 sm:grid-cols-[4rem_minmax(12rem,1fr)_minmax(10rem,auto)] sm:items-start"
        >
          <div className="flex items-center gap-3 sm:block">
            <RankBadge rank={row.rank} size="md" />
            <span className="min-w-0 font-semibold text-[var(--color-text-primary)] sm:hidden">
              <MemberSequenceLabel memberId={row.memberId}>{row.displayName}</MemberSequenceLabel>
            </span>
          </div>

          <div className="min-w-0">
            <span className="min-w-0 font-semibold text-[var(--color-text-primary)] max-sm:hidden">
              <MemberSequenceLabel memberId={row.memberId}>{row.displayName}</MemberSequenceLabel>
            </span>
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
            <p className="text-xs font-semibold text-[var(--color-text-secondary)]">総資産</p>
            <p className="mt-0.5 text-xl font-semibold text-[var(--color-text-primary)] tabular-nums">
              {formatManYen(row.totalAssetsManYen)}
            </p>
          </div>

          <div className="col-span-full flex min-w-0 flex-wrap items-center justify-between gap-2 pt-1 text-xs sm:col-span-2 sm:col-start-2">
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
      <span className={cn("rounded-xs border px-2 py-0.5 font-semibold", trendTone(row.trend))}>
        {trendLabel(row)}
      </span>
    </span>
  );
}

function formatAverageRank(value: number): string {
  return value.toFixed(2);
}

function formatOrdinal(value: number | undefined): string {
  if (value === undefined) return "—";
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
    return "border-[var(--color-analysis-positive)]/45 bg-[var(--color-analysis-positive)]/10 text-[var(--color-analysis-positive)]";
  }
  if (trend === "declined") {
    return "border-[var(--color-analysis-negative)]/35 bg-[var(--color-analysis-negative)]/8 text-[var(--color-analysis-negative)]";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]";
}
