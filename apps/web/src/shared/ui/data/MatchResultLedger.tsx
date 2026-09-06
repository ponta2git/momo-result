import type { ReactNode } from "react";

import type { MatchPerformanceContextRow } from "@/shared/domain/matchPerformanceContext";
import { formatManYen } from "@/shared/lib/formatters";
import { cn } from "@/shared/ui/cn";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { PlayOrderMark } from "@/shared/ui/data/PlayOrderMark";
import { RankBadge } from "@/shared/ui/rank/RankBadge";
import { contentText } from "@/shared/ui/typography";

type MatchResultLedgerRow = MatchPerformanceContextRow & {
  displayName: string;
  playOrder?: number | undefined;
  details?: ReactNode;
};

type MatchResultLedgerContextStatus = "loading" | "ready" | "unavailable";
type MatchResultLedgerPresentation = "embedded" | "standalone";

export const matchResultLedgerRowClass = "grid min-w-0 content-start gap-4 p-4";
export const matchResultLedgerGridClass = "grid min-w-0 gap-4 lg:grid-cols-2";

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
  return (
    <ol aria-label={ariaLabel} className={matchResultLedgerGridClass}>
      {rows
        .toSorted((left, right) => left.rank - right.rank)
        .map((row) => (
          <li
            key={row.memberId}
            className={cn(
              matchResultLedgerRowClass,
              "border border-[var(--color-border)]",
              presentation === "embedded" ? "rounded-sm" : "rounded-md",
            )}
          >
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <RankBadge rank={row.rank} size="md" />
                <h3 className={cn(contentText.primary, "min-w-0")}>
                  <MemberSequenceLabel accent={row.playOrder === undefined} memberId={row.memberId}>
                    {row.displayName}
                  </MemberSequenceLabel>
                </h3>
              </div>
              {row.playOrder === undefined ? null : <PlayOrderMark playOrder={row.playOrder} />}
            </div>

            <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] items-start gap-4">
              <div className="min-w-0">
                <dt className={contentText.supporting}>総資産</dt>
                <dd className={cn(contentText.primary, "mt-1 break-words tabular-nums")}>
                  {formatManYen(row.totalAssetsManYen)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className={contentText.supporting}>物件収益</dt>
                <dd className={cn(contentText.body, "mt-1 break-words tabular-nums")}>
                  {formatManYen(row.revenueManYen)}
                </dd>
                <dd className={cn(contentText.supporting, "mt-1 grid gap-1 tabular-nums")}>
                  <span>収益順位 {formatOrdinal(row.revenueRank)}</span>
                  <span>
                    物件収益比率{" "}
                    {row.revenueAssetRate === undefined
                      ? row.totalAssetsManYen <= 0
                        ? "対象外"
                        : "—"
                      : formatRevenueAssetRate(row.revenueAssetRate)}
                  </span>
                </dd>
              </div>
            </dl>
            <dl className="grid gap-1">
              <dt className={contentText.supporting}>通算平均順位</dt>
              <dd>
                <AverageRankChange contextStatus={contextStatus} row={row} />
              </dd>
            </dl>
            {row.details}
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
    return <span className={contentText.supporting}>比較データを読み込み中</span>;
  }
  if (
    contextStatus === "unavailable" ||
    row.trend === "unavailable" ||
    row.cumulativeAverageAfter === undefined
  ) {
    return <span className={contentText.supporting}>比較データなし</span>;
  }

  const transition =
    row.cumulativeAverageBefore === undefined
      ? formatAverageRank(row.cumulativeAverageAfter)
      : `${formatAverageRank(row.cumulativeAverageBefore)} → ${formatAverageRank(
          row.cumulativeAverageAfter,
        )}`;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <strong className={cn(contentText.body, "tabular-nums")}>{transition}</strong>
      <span
        className={cn("rounded-xs border px-2 py-0.5 text-xs/4 font-plain", trendTone(row.trend))}
      >
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
