import { Check, ChevronDown, Minus } from "lucide-react";

import {
  DrilldownTableCell,
  DrilldownTableHeader,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownPrimitives";
import type { RankSignalDetail } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankAnalysisDrilldownTypes";
import {
  rankSignalDirectionLabel,
  rankSignalFoldLabel,
  rankSignalFoldLabels,
  rankSignalLabel,
  rankSignalPriorityLabel,
} from "@/features/seriesComparison/model/seriesComparisonRankAnalysis";
import { cn } from "@/shared/ui/cn";

type FoldRow = NonNullable<RankSignalDetail["foldRows"]>[number];

const importanceFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 6,
  minimumFractionDigits: 3,
  signDisplay: "exceptZero",
});

export function RankSignalEvidenceCard({
  candidateCount,
  candidateShare,
  index,
  signal,
}: {
  candidateCount: number;
  candidateShare: number;
  index: number;
  signal: RankSignalDetail;
}) {
  const foldRows = signal.foldRows ?? [];
  return (
    <article className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {rankSignalLabel(signal.signal)}
          </h3>
          <span className="text-[11px] font-medium text-[var(--color-text-muted)]">
            {rankSignalPriorityLabel(index, candidateCount)}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
          {rankSignalDirectionLabel(signal)}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <CandidateShareEvidence
          candidateCount={candidateCount}
          label={rankSignalLabel(signal.signal)}
          share={candidateShare}
        />
        <FoldSupportEvidence label={rankSignalLabel(signal.signal)} rows={foldRows} />
      </div>

      <FoldValueDetails label={rankSignalLabel(signal.signal)} rows={foldRows} />
    </article>
  );
}

function CandidateShareEvidence({
  candidateCount,
  label,
  share,
}: {
  candidateCount: number;
  label: string;
  share: number;
}) {
  if (candidateCount <= 1) {
    return (
      <div className="grid content-start gap-1 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
        <p className="text-[11px] text-[var(--color-text-secondary)]">候補内の比重</p>
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">候補はこの1件</p>
        <p className="text-[11px] leading-4 text-[var(--color-text-muted)]">
          比べる候補がないため、100%とは表示しません。
        </p>
      </div>
    );
  }
  return (
    <div
      aria-label={`${label}の候補内の比重 ${share}%`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={share}
      aria-valuetext={`${share}%、このプレーヤーの候補内で比較`}
      className="grid content-start gap-2 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
      role="meter"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] text-[var(--color-text-secondary)]">候補内の比重</p>
        <p className="text-base font-semibold text-[var(--color-text-primary)] tabular-nums">
          {share}%
        </p>
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden bg-[var(--color-surface-selected)]">
        <div className="h-full bg-[var(--color-text-secondary)]" style={{ width: `${share}%` }} />
      </div>
      <p className="text-[11px] leading-4 text-[var(--color-text-muted)]">
        この人の候補の合計を100%に換算。勝率ではありません。
      </p>
    </div>
  );
}

function FoldSupportEvidence({ label, rows }: { label: string; rows: FoldRow[] }) {
  const rowsByFold = new Map(rows.map((row) => [row.fold, row]));
  const supportCount = rows.filter((row) => row.importance > 0).length;
  return (
    <div
      aria-label={`${label}の別開催テスト、5組中${supportCount}組が支持`}
      className="grid content-start gap-2 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
      role="group"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] text-[var(--color-text-secondary)]">別開催での再現</p>
        <p className="text-xs font-semibold text-[var(--color-text-primary)] tabular-nums">
          {supportCount}/5組
        </p>
      </div>
      <ol className="grid grid-cols-5 gap-1">
        {rankSignalFoldLabels.map((foldLabel, index) => {
          const supported = (rowsByFold.get(index)?.importance ?? 0) > 0;
          return (
            <li
              aria-label={`開催${foldLabel}: ${supported ? "支持" : "支持なし"}`}
              className={cn(
                "grid min-w-0 justify-items-center gap-1 rounded-[var(--radius-xs)] border px-1 py-2 text-center",
                supported
                  ? "border-[var(--color-success)]/45 bg-[var(--color-success)]/10"
                  : "border-[var(--color-border)] bg-[var(--color-surface)]",
              )}
              key={foldLabel}
            >
              {supported ? (
                <Check aria-hidden="true" className="size-3.5 text-[var(--color-success)]" />
              ) : (
                <Minus aria-hidden="true" className="size-3.5 text-[var(--color-text-muted)]" />
              )}
              <span className="text-[10px] font-semibold text-[var(--color-text-primary)]">
                開催{foldLabel}
              </span>
              <span className="text-[9px] leading-3 text-[var(--color-text-muted)]">
                {supported ? "支持" : "支持なし"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FoldValueDetails({ label, rows }: { label: string; rows: FoldRow[] }) {
  return (
    <details className="group overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-action)]">
        <span>5組の数値を見る</span>
        <span className="inline-flex items-center gap-2 font-normal text-[var(--color-text-muted)]">
          0が境目
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform duration-[var(--motion-fast)] group-open:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </summary>
      <div className="grid gap-2 border-t border-[var(--color-border)] p-3">
        <p className="text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
          記録を開催内で入れ替えた後の値です。プラスなら順位の読み取りが悪化し、その開催グループでは手掛かりを支持。0以下なら支持なしです。
        </p>
        <div className="overflow-x-auto rounded-[var(--radius-xs)] border border-[var(--color-border)]">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">{label}の別開催テストAからEの数値</caption>
            <thead>
              <tr>
                <DrilldownTableHeader>別開催テスト</DrilldownTableHeader>
                <DrilldownTableHeader align="right">確認に使った開催</DrilldownTableHeader>
                <DrilldownTableHeader align="right">順位の2人組</DrilldownTableHeader>
                <DrilldownTableHeader align="right">記録入替の結果</DrilldownTableHeader>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const supported = row.importance > 0;
                return (
                  <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.fold}>
                    <DrilldownTableCell>開催{rankSignalFoldLabel(row.fold)}</DrilldownTableCell>
                    <DrilldownTableCell align="right">{row.heldEventCount}開催</DrilldownTableCell>
                    <DrilldownTableCell align="right">{row.comparisonCount}組</DrilldownTableCell>
                    <DrilldownTableCell align="right">
                      <span
                        className={cn(
                          "inline-flex min-h-7 items-center gap-1 rounded-[var(--radius-xs)] border px-2 py-0.5 text-xs font-semibold",
                          supported
                            ? "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-text-primary)]"
                            : "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
                        )}
                      >
                        {supported ? "支持" : "支持なし"}
                        <span className="tabular-nums">{formatImportance(row.importance)}</span>
                      </span>
                    </DrilldownTableCell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] leading-4 text-[var(--color-text-muted)]">
          値の大きさは、同じプレーヤー・同じ分析範囲の候補同士だけで比較します。
        </p>
      </div>
    </details>
  );
}

function formatImportance(importance: number): string {
  return Number.isFinite(importance) ? importanceFormatter.format(importance) : "-";
}
