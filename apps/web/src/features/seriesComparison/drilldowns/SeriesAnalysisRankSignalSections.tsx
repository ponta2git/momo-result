import { Check, Minus } from "lucide-react";

import { evidenceStrengthLabel } from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import {
  formatRankSignalImportance,
  rankSignalCandidateShareLabel,
  rankSignalFoldLabel,
  rankSignalLabel,
} from "@/features/seriesComparison/model/seriesAnalysisRankPresentation";
import type { SeriesAnalysisDrilldownV3 } from "@/shared/api/seriesAnalysis";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";

export type RankSignalPayload = Extract<
  SeriesAnalysisDrilldownV3["payload"],
  { kind: "rank_signals" }
>;
type RankSignalCandidate = RankSignalPayload["candidates"][number];

export function RankSignalValidationMethod({ payload }: { payload: RankSignalPayload }) {
  const rows = payload.candidates[0]?.foldRows ?? [];
  const rowsByFold = new Map(rows.map((row) => [row.fold, row]));
  const trainingFoldCount = payload.method.foldCount > 0 ? payload.method.foldCount - 1 : 0;
  return (
    <Disclosure
      ariaLabel="別開催テストと採用基準"
      panelPadding="md"
      presentation="inset"
      summary={
        <span className="flex flex-col gap-0.5">
          <span>検証方法と採用基準</span>
          <span className="text-xs font-normal text-pretty text-[var(--color-text-secondary)] tabular-nums">
            {payload.method.foldCount}組中{payload.method.requiredImprovedFoldCount}組以上で改善
          </span>
        </span>
      }
      triggerVariant="supporting"
    >
      <div className="grid gap-6">
        <section aria-labelledby="rank-signal-validation-flow">
          <h4 className="text-sm font-semibold text-balance" id="rank-signal-validation-flow">
            検証の流れ
          </h4>
          <ol className="mt-3 grid gap-4 sm:grid-cols-3 sm:divide-x sm:divide-[var(--color-border)]">
            <MethodStep
              number="1"
              title="開催を分ける"
              value={`${payload.method.foldCount}組に分割`}
            />
            <MethodStep number="2" title="候補を作る" value={`${trainingFoldCount}組を使用`} />
            <MethodStep number="3" title="別開催で確かめる" value="残した1組を使用" />
          </ol>
        </section>
        <section aria-labelledby="rank-signal-adoption-rules">
          <h4 className="text-sm font-semibold text-balance" id="rank-signal-adoption-rules">
            採用基準
          </h4>
          <dl className="mt-2 divide-y divide-[var(--color-border)] text-sm">
            <MethodFact
              label="必要な記録"
              value={`${payload.method.minimumMatches}戦・${payload.method.minimumHeldEvents}開催以上`}
            />
            <MethodFact
              label="全体モデル"
              value={`${payload.method.foldCount}組中${payload.method.requiredImprovedFoldCount}組以上で改善`}
            />
            <MethodFact
              label="候補の境目"
              value={`重要度 ${formatRankSignalImportance(payload.method.minimumImportance)}以上`}
            />
          </dl>
        </section>
        <section aria-labelledby="rank-signal-validation-groups">
          <h4 className="text-sm font-semibold text-balance" id="rank-signal-validation-groups">
            確認グループ
          </h4>
          <ol
            aria-label="別開催テストの開催グループ"
            className="mt-2 flex flex-wrap gap-x-6 gap-y-2"
          >
            {Array.from({ length: payload.method.foldCount }, (_, fold) => {
              const row = rowsByFold.get(fold);
              return (
                <li className="flex items-baseline gap-2 text-sm" key={fold}>
                  <span className="font-medium">開催{rankSignalFoldLabel(fold)}</span>
                  <span className="text-[var(--color-text-secondary)] tabular-nums">
                    {row ? `${row.heldEventCount}開催` : "確認用"}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </Disclosure>
  );
}

export function RankSignalCandidates({ payload }: { payload: RankSignalPayload }) {
  return (
    <section aria-labelledby="rank-signal-candidates">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-balance" id="rank-signal-candidates">
          手掛かり候補
        </h3>
        <p className="text-xs text-[var(--color-text-secondary)] tabular-nums">
          {payload.candidates.length}件
        </p>
      </div>
      <div className="mt-2 grid min-w-0 gap-8">
        {payload.candidates.map((candidate) => (
          <CandidateCard
            candidate={candidate}
            candidateCount={payload.candidates.length}
            foldCount={payload.method.foldCount}
            key={candidate.signal}
          />
        ))}
      </div>
    </section>
  );
}

function MethodStep({ number, title, value }: { number: string; title: string; value: string }) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 sm:px-4 sm:first:pl-0 sm:last:pr-0">
      <span
        className="flex size-6 items-center justify-center rounded-xs bg-[var(--color-surface-selected)] text-xs font-medium text-[var(--color-text-primary)] tabular-nums"
        aria-hidden="true"
      >
        {number}
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] tabular-nums">{value}</p>
      </div>
    </li>
  );
}

function MethodFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function CandidateCard({
  candidate,
  candidateCount,
  foldCount,
}: {
  candidate: RankSignalCandidate;
  candidateCount: number;
  foldCount: number;
}) {
  const rowByFold = new Map(candidate.foldRows.map((row) => [row.fold, row]));
  const candidateLabel = rankSignalLabel(candidate.signal);
  return (
    <article aria-label={`${candidateLabel}の検証結果`} className="min-w-0">
      <header className="pb-3">
        <h4 className="font-semibold text-balance">{candidateLabel}</h4>
      </header>
      <div>
        <dl className="grid divide-y divide-[var(--color-border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <CandidateFact
            emphasis
            label="別開催で支持"
            value={`${candidate.supportCount}/${foldCount}組`}
          />
          <CandidateFact label="安定性" value={evidenceStrengthLabel(candidate.stabilityBand)} />
          <CandidateFact
            label="候補内の比重"
            value={rankSignalCandidateShareLabel(candidate.candidateSharePercent, candidateCount)}
          />
        </dl>
        <div className="mt-4">
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">開催ごとの判定</p>
          <ol
            aria-label={`${candidateLabel}の別開催での支持`}
            className="mt-2 grid grid-cols-5 divide-x divide-[var(--color-border)] overflow-hidden rounded-xs border border-[var(--color-border)]"
          >
            {Array.from({ length: foldCount }, (_, fold) => {
              const row = rowByFold.get(fold);
              const supported = row?.supported ?? false;
              return (
                <li
                  aria-label={`開催${rankSignalFoldLabel(fold)}、${row ? (supported ? "支持" : "支持なし") : "データなし"}`}
                  className="grid min-w-0 justify-items-center gap-1 px-1 py-3 text-center"
                  key={fold}
                >
                  {row && supported ? (
                    <Check
                      aria-hidden="true"
                      className="size-3.5 text-[var(--color-analysis-positive)]"
                    />
                  ) : (
                    <Minus aria-hidden="true" className="size-3.5 text-[var(--color-text-muted)]" />
                  )}
                  <span className="text-xs font-medium">開催{rankSignalFoldLabel(fold)}</span>
                  <span
                    className={cn(
                      "text-xs",
                      row && supported
                        ? "text-[var(--color-analysis-positive)]"
                        : "text-[var(--color-text-secondary)]",
                    )}
                  >
                    {row ? (supported ? "支持" : "支持なし") : "データなし"}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="mt-4">
          <FoldDetails candidate={candidate} />
        </div>
      </div>
    </article>
  );
}

function CandidateFact({
  emphasis = false,
  label,
  value,
}: {
  emphasis?: boolean | undefined;
  label: string;
  value: string;
}) {
  return (
    <div className="py-3 sm:px-3 sm:first:pl-0 sm:last:pr-0">
      <dt className="text-xs text-[var(--color-text-secondary)]">{label}</dt>
      <dd className={cn("mt-0.5 font-semibold tabular-nums", emphasis && "text-lg")}>{value}</dd>
    </div>
  );
}

function FoldDetails({ candidate }: { candidate: RankSignalCandidate }) {
  return (
    <Disclosure
      ariaLabel={`${rankSignalLabel(candidate.signal)}の開催別の数値`}
      panelPadding="sm"
      presentation="inset"
      summary={
        <span className="flex items-baseline justify-between gap-3">
          <span>開催別の数値</span>
          <span className="text-xs font-normal text-[var(--color-text-secondary)] tabular-nums">
            {candidate.foldRows.length}組
          </span>
        </span>
      }
      triggerLayout="flush-horizontal"
    >
      <DataTable
        caption={{ content: `${rankSignalLabel(candidate.signal)}の開催別テスト結果` }}
        columns={[
          {
            tabular: true,
            header: "確認組",
            key: "fold",
            renderCell: (row) => `開催${rankSignalFoldLabel(row.fold)}`,
            rowHeader: true,
          },
          {
            tabular: true,
            header: "開催数",
            key: "event-count",
            renderCell: (row) => `${row.heldEventCount}開催`,
          },
          {
            tabular: true,
            header: "順位の2人組",
            key: "comparison-count",
            renderCell: (row) => `${row.comparisonCount}組`,
          },
          {
            header: "判定",
            key: "support",
            renderCell: (row) => (row.supported ? "支持" : "支持なし"),
          },
          {
            tabular: true,
            header: "重要度",
            key: "importance",
            renderCell: (row) => formatRankSignalImportance(row.importance),
          },
        ]}
        density="compact"
        getRowKey={(row) => String(row.fold)}
        minWidth="36rem"
        rows={candidate.foldRows}
      />
    </Disclosure>
  );
}
