import {
  RankSignalCandidates,
  RankSignalValidationMethod,
} from "@/features/seriesComparison/drilldowns/SeriesAnalysisRankSignalSections";
import type { RankSignalPayload } from "@/features/seriesComparison/drilldowns/SeriesAnalysisRankSignalSections";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import { Notice } from "@/shared/ui/feedback/Notice";

export function RankSignalDrilldown({ payload }: { payload: RankSignalPayload }) {
  const qualityAdvisory = qualityAdvisoryLabel(payload.status);
  return (
    <div className="grid gap-5">
      <RankSignalSummary payload={payload} qualityAdvisory={qualityAdvisory} />
      <section aria-labelledby="rank-signal-reading-order">
        <h3 className="text-sm font-semibold text-balance" id="rank-signal-reading-order">
          判断の順序
        </h3>
        <ol aria-label="順位を読む手掛かりの使い方" className="mt-3 grid gap-4 sm:grid-cols-2">
          <GuideStep
            number="1"
            label="候補を選ぶ"
            value="別開催での支持と安定性を先に見て、候補内の比重は補助として比べます。"
          />
          <GuideStep
            number="2"
            label="次戦で確かめる"
            value="観察する項目を1つ決め、試合後に同じ傾向が続いたか確認します。"
          />
        </ol>
        <p className="mt-3 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
          <span className="font-medium text-[var(--color-text-primary)]">使わない：</span>
          候補内の比重を、勝率や次戦順位の確率には読み替えません。
        </p>
      </section>
      <RankSignalValidationMethod payload={payload} />
      {payload.candidates.length === 0 ? (
        <Notice tone="info" title="採用できる手掛かりはありません">
          この範囲では単独の手掛かりを採用せず、順位分布や直接対決を優先してください。
        </Notice>
      ) : (
        <RankSignalCandidates payload={payload} />
      )}
    </div>
  );
}

function RankSignalSummary({
  payload,
  qualityAdvisory,
}: {
  payload: RankSignalPayload;
  qualityAdvisory: string | null;
}) {
  return (
    <section
      aria-label="順位を読む手掛かりの分析範囲"
      className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"
    >
      <div className="py-3 sm:pr-5">
        <p className="text-xs text-[var(--color-text-secondary)]">別開催テスト</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums">
          {payload.improvedFoldCount}/{payload.method.foldCount}組で改善
        </p>
        {qualityAdvisory ? (
          <div className="mt-1">
            <SeriesAnalysisQualityAdvisory status={payload.status} />
          </div>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:items-center sm:border-l sm:border-[var(--color-border)] sm:pl-5">
        <div>
          <dt className="text-xs text-[var(--color-text-secondary)]">対象試合</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{payload.matchCount}戦</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-secondary)]">対象開催</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{payload.heldEventCount}開催</dd>
        </div>
      </dl>
    </section>
  );
}

function GuideStep({ label, number, value }: { label: string; number: string; value: string }) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 sm:border-l sm:border-[var(--color-border)] sm:px-4 sm:first:border-l-0 sm:first:pl-0 sm:last:pr-0">
      <span
        className="flex size-6 items-center justify-center rounded-[var(--radius-xs)] bg-[var(--color-surface-selected)] text-xs font-medium text-[var(--color-text-primary)] tabular-nums"
        aria-hidden="true"
      >
        {number}
      </span>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
          {value}
        </p>
      </div>
    </li>
  );
}
