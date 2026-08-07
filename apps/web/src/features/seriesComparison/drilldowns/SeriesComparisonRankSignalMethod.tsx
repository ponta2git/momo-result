import { ArrowRight, Check } from "lucide-react";

import type { RankSignalDetail } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankAnalysisDrilldownTypes";
import { rankSignalFoldLabels } from "@/features/seriesComparison/model/seriesComparisonRankAnalysis";

type FoldRow = NonNullable<RankSignalDetail["foldRows"]>[number];

export function HeldEventTestMethod({
  foldRows,
  heldEventCount,
}: {
  foldRows: FoldRow[];
  heldEventCount: number;
}) {
  const rowsByFold = new Map(foldRows.map((row) => [row.fold, row]));
  return (
    <section
      aria-label="開催を5組に分けた別開催テスト"
      className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          開催を5組に分けて、別開催でテスト
        </h3>
        <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
          A〜Eは評価の段階ではなく、重ならない開催グループです。各組を1度ずつ計算から外し、その組だけで読み方を確かめます。
        </p>
      </div>
      <ol className="grid grid-cols-5 gap-1" aria-label="5つの開催グループ">
        {rankSignalFoldLabels.map((label, index) => (
          <li
            className="grid min-w-0 gap-0.5 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-1 py-2 text-center"
            key={label}
          >
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">
              開催{label}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
              {rowsByFold.get(index)?.heldEventCount ??
                heldEventCountForFold(heldEventCount, index)}
              開催
            </span>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-center text-xs">
        <span className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-2 text-[var(--color-text-secondary)]">
          B〜Eで読み方を作る
        </span>
        <ArrowRight aria-hidden="true" className="size-4 text-[var(--color-text-muted)]" />
        <span className="rounded-[var(--radius-xs)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-2 font-semibold text-[var(--color-text-primary)]">
          Aだけで確かめる
        </span>
      </div>
    </section>
  );
}

export function CandidateAdmissionCriteria() {
  const criteria = [
    ["向きが安定", "5回中4回以上同じ"],
    ["別開催で再現", "5組中3組以上が支持"],
    ["平均でも支持", "入替後 +0.0001以上"],
  ] as const;
  return (
    <section aria-labelledby="rank-signal-admission-title" className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          className="text-sm font-semibold text-[var(--color-text-primary)]"
          id="rank-signal-admission-title"
        >
          手掛かり候補として載る基準
        </h3>
        <span className="text-[11px] text-[var(--color-text-muted)]">3条件をすべて満たす</span>
      </div>
      <ul className="grid overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] sm:grid-cols-3 sm:divide-x sm:divide-[var(--color-border)]">
        {criteria.map(([label, value]) => (
          <li
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-b border-[var(--color-border)] p-3 last:border-b-0 sm:border-b-0"
            key={label}
          >
            <Check aria-hidden="true" className="mt-0.5 size-4 text-[var(--color-success)]" />
            <span className="grid gap-0.5">
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                {label}
              </span>
              <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                {value}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function heldEventCountForFold(heldEventCount: number, fold: number): number {
  return Math.max(
    0,
    Math.floor(
      (heldEventCount + rankSignalFoldLabels.length - 1 - fold) / rankSignalFoldLabels.length,
    ),
  );
}
