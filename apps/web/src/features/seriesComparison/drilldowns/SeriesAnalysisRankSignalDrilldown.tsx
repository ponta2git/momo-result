import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";

import { DrilldownFacts } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownPrimitives";
import {
  evidenceStrengthLabel,
  qualityLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import {
  rankSignalCandidateShareLabel,
  rankSignalLabel,
} from "@/features/seriesComparison/model/seriesAnalysisRankPresentation";
import type { SeriesAnalysisDrilldownV3 } from "@/shared/api/seriesAnalysis";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { Notice } from "@/shared/ui/feedback/Notice";

type RankSignalPayload = Extract<SeriesAnalysisDrilldownV3["payload"], { kind: "rank_signals" }>;
type RankSignalCandidate = RankSignalPayload["candidates"][number];

const importanceFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 6,
  minimumFractionDigits: 3,
  signDisplay: "exceptZero",
});

export function RankSignalDrilldown({ payload }: { payload: RankSignalPayload }) {
  return (
    <div className="grid gap-4">
      <DrilldownFacts
        ariaLabel="順位を読む手掛かりの分析範囲"
        items={[
          { id: "matches", label: "対象試合", value: `${payload.matchCount}戦` },
          { id: "events", label: "対象開催", value: `${payload.heldEventCount}開催` },
          { id: "quality", label: "読み取り", value: qualityLabel(payload.status) },
          {
            id: "validation",
            label: "別開催テスト",
            value: `${payload.improvedFoldCount}/${payload.method.foldCount}組で改善`,
          },
        ]}
      />
      <dl
        aria-label="順位を読む手掛かりの使い方"
        className="grid gap-px overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-3"
      >
        <GuideFact label="選ぶ" value="候補内の比重だけでなく、別開催での支持と安定性も高い候補" />
        <GuideFact
          label="次戦で使う"
          value="観察する項目を1つ決め、試合後に同じ傾向が続いたか確認"
        />
        <GuideFact label="使わない" value="勝率や次戦順位の確率への読み替え" />
      </dl>
      <ValidationMethod payload={payload} />
      {payload.candidates.length === 0 ? (
        <Notice tone="info" title="採用できる手掛かりはありません">
          この範囲では単独の手掛かりを採用せず、順位分布や直接対決を優先してください。
        </Notice>
      ) : (
        <div className="grid gap-3">
          {payload.candidates.map((candidate) => (
            <CandidateCard
              candidate={candidate}
              candidateCount={payload.candidates.length}
              foldCount={payload.method.foldCount}
              key={candidate.signal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GuideFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface-subtle)] px-3 py-2">
      <dt className="text-[11px] font-semibold text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

function ValidationMethod({ payload }: { payload: RankSignalPayload }) {
  const rows = payload.candidates[0]?.foldRows ?? [];
  const rowsByFold = new Map(rows.map((row) => [row.fold, row]));
  const trainingFoldCount = payload.method.foldCount > 0 ? payload.method.foldCount - 1 : 0;
  return (
    <Disclosure
      ariaLabel="別開催テストと採用基準"
      className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]"
      panelClassName="grid gap-3 border-t border-[var(--color-border)] p-3"
      summary="別開催テストと採用基準"
    >
      <ol aria-label="別開催テストの開催グループ" className="grid grid-cols-5 gap-1">
        {Array.from({ length: payload.method.foldCount }, (_, fold) => {
          const row = rowsByFold.get(fold);
          return (
            <li
              className="grid min-w-0 gap-0.5 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-1 py-2 text-center"
              key={fold}
            >
              <span className="text-xs font-semibold">開催{foldLabel(fold)}</span>
              <span className="text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                {row ? `${row.heldEventCount}開催` : "確認用"}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="grid gap-1 text-center text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <span className="rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-2 py-2">
          {trainingFoldCount}組で候補を作る
        </span>
        <span aria-hidden="true" className="text-[var(--color-text-muted)]">
          →
        </span>
        <span className="rounded-[var(--radius-xs)] border border-[var(--color-border-strong)] px-2 py-2 font-semibold">
          残した1組で確かめる
        </span>
      </div>
      <dl className="grid gap-2 text-xs sm:grid-cols-3">
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
          value={`重要度 ${formatImportance(payload.method.minimumImportance)}以上`}
        />
      </dl>
    </Disclosure>
  );
}

function MethodFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] p-2">
      <dt className="font-semibold">{label}</dt>
      <dd className="mt-0.5 text-[var(--color-text-secondary)] tabular-nums">{value}</dd>
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
  return (
    <article className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
      <h3 className="font-semibold">{rankSignalLabel(candidate.signal)}</h3>
      <dl className="grid gap-px overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-3">
        <CandidateFact
          label="候補内の比重"
          value={rankSignalCandidateShareLabel(candidate.candidateSharePercent, candidateCount)}
        />
        <CandidateFact label="別開催で支持" value={`${candidate.supportCount}/${foldCount}組`} />
        <CandidateFact label="安定性" value={evidenceStrengthLabel(candidate.stabilityBand)} />
      </dl>
      <ol
        aria-label={`${rankSignalLabel(candidate.signal)}の別開催での支持`}
        className="grid grid-cols-5 gap-1"
      >
        {Array.from({ length: foldCount }, (_, fold) => {
          const row = rowByFold.get(fold);
          const supported = row?.supported ?? false;
          return (
            <li
              aria-label={`開催${foldLabel(fold)}、${row ? (supported ? "支持" : "支持なし") : "データなし"}`}
              className={cn(
                "grid min-w-0 justify-items-center gap-1 rounded-[var(--radius-xs)] border px-1 py-2 text-center",
                row && supported
                  ? "border-[var(--color-success)]/45 bg-[var(--color-success)]/10"
                  : "border-[var(--color-border)] bg-[var(--color-surface-subtle)]",
              )}
              key={fold}
            >
              {row && supported ? (
                <Check aria-hidden="true" className="size-3.5 text-[var(--color-success)]" />
              ) : (
                <Minus aria-hidden="true" className="size-3.5 text-[var(--color-text-muted)]" />
              )}
              <span className="text-[11px] font-semibold">開催{foldLabel(fold)}</span>
              <span className="text-[11px] text-[var(--color-text-secondary)]">
                {row ? (supported ? "支持" : "支持なし") : "データなし"}
              </span>
            </li>
          );
        })}
      </ol>
      <FoldDetails candidate={candidate} />
    </article>
  );
}

function CandidateFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface-subtle)] px-3 py-2">
      <dt className="text-[11px] text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function FoldDetails({ candidate }: { candidate: RankSignalCandidate }) {
  return (
    <Disclosure
      ariaLabel={`${rankSignalLabel(candidate.signal)}の開催別の数値`}
      className="rounded-[var(--radius-xs)] border border-[var(--color-border)]"
      panelClassName="overflow-x-auto border-t border-[var(--color-border)] p-3"
      summary="開催別の数値"
    >
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="sr-only">{rankSignalLabel(candidate.signal)}の開催別テスト結果</caption>
        <thead>
          <tr>
            <FoldTableHead>確認組</FoldTableHead>
            <FoldTableHead>開催数</FoldTableHead>
            <FoldTableHead>順位の2人組</FoldTableHead>
            <FoldTableHead>判定</FoldTableHead>
            <FoldTableHead>重要度</FoldTableHead>
          </tr>
        </thead>
        <tbody>
          {candidate.foldRows.map((row) => (
            <tr className="border-t border-[var(--color-border)]" key={row.fold}>
              <FoldTableCell>開催{foldLabel(row.fold)}</FoldTableCell>
              <FoldTableCell>{row.heldEventCount}開催</FoldTableCell>
              <FoldTableCell>{row.comparisonCount}組</FoldTableCell>
              <FoldTableCell>{row.supported ? "支持" : "支持なし"}</FoldTableCell>
              <FoldTableCell>{formatImportance(row.importance)}</FoldTableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </Disclosure>
  );
}

function FoldTableHead({ children }: { children: ReactNode }) {
  return (
    <th className="bg-[var(--color-surface-subtle)] px-3 py-2 font-semibold" scope="col">
      {children}
    </th>
  );
}

function FoldTableCell({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 tabular-nums">{children}</td>;
}

function foldLabel(fold: number): string {
  return fold >= 0 && fold < 26 ? String.fromCodePoint(65 + fold) : String(fold + 1);
}

function formatImportance(value: number): string {
  return Number.isFinite(value) ? importanceFormatter.format(value) : "—";
}
