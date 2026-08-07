import {
  DrilldownContentSkeleton,
  DrilldownLoadNotice,
  DrilldownPlayerSelector,
  DrilldownTableCell,
  DrilldownTableHeader,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownPrimitives";
import type { RankSignalsDrilldownPayload } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankAnalysisDrilldownTypes";
import { useSeriesComparisonDrilldownQuery } from "@/features/seriesComparison/drilldowns/useSeriesComparisonDrilldownQuery";
import { StatusBadge } from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import { formatDecimal } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import {
  rankAnalysisAvailabilityText,
  rankSignalDirectionLabel,
  rankSignalLabel,
} from "@/features/seriesComparison/model/seriesComparisonRankAnalysis";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

export function RankSignalsDrilldownDialog({
  onMemberChange,
  onOpenChange,
  open,
  response,
  selectedMemberId,
}: {
  onMemberChange: (memberId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  response: SeriesComparisonResponse;
  selectedMemberId: string | null;
}) {
  const { drilldownQuery, players, selectedPlayer } = useSeriesComparisonDrilldownQuery({
    metricId: "rankAnalysis.rankSignals",
    open,
    response,
    selectedMemberId,
  });
  const data = drilldownQuery.data;
  const payload = data?.rankSignals;
  const loading = open && isInitialQueryLoading(drilldownQuery);
  const showError = shouldShowBlockingQueryError(drilldownQuery);
  const showCachedError = Boolean(data && shouldShowQueryError(drilldownQuery));
  const retry = () => void drilldownQuery.refetch();
  const title = selectedPlayer
    ? `順位を読む手掛かり: ${selectedPlayer.displayName}`
    : "順位を読む手掛かり";

  return (
    <Dialog
      className="flex h-full min-h-0 flex-col"
      description="開催回ごとの保留評価で、同じ結びつきが繰り返し見えるかを確認します。"
      open={open}
      popupClassName="max-w-[min(76rem,calc(100vw-1rem))] items-stretch p-2 sm:p-4"
      surfaceClassName="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] !overflow-hidden p-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)]"
      title={title}
      onOpenChange={onOpenChange}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <DrilldownPlayerSelector
          players={players}
          selectedMemberId={selectedPlayer?.memberId}
          onMemberChange={onMemberChange}
        />
        {loading ? (
          <DrilldownContentSkeleton label="順位の手掛かりを読み込み中" />
        ) : showError ? (
          <DrilldownLoadNotice
            description="順位の手掛かりの取得に失敗しました。通信状態を確認して、もう一度お試しください。"
            pending={drilldownQuery.isFetching}
            title="詳細を表示できません"
            onRetry={retry}
          />
        ) : data ? (
          <StaleShield
            active={drilldownQuery.isFetching}
            busyLabel="順位の手掛かりを更新中"
            className="h-full min-h-0"
            contentClassName="h-full min-h-0"
            fallback={<DrilldownContentSkeleton label="順位の手掛かりを読み込み中" />}
            preserveContent
          >
            <div className="grid h-full min-h-0 content-start gap-3 overflow-y-auto overscroll-contain pr-1">
              {showCachedError ? (
                <DrilldownLoadNotice
                  description="直前に取得した詳細を表示しています。"
                  title="最新の詳細を取得できません"
                  tone="warning"
                  onRetry={retry}
                />
              ) : null}
              {payload ? (
                <RankSignalsDetails payload={payload} />
              ) : (
                <RankSignalsPayloadNotice onRetry={retry} />
              )}
            </div>
          </StaleShield>
        ) : (
          <EmptyState
            description="プレーヤーを選択すると詳細を取得します。"
            title="詳細がありません"
          />
        )}
      </div>
    </Dialog>
  );
}

function RankSignalsDetails({ payload }: { payload: RankSignalsDrilldownPayload }) {
  const signals = payload.signals ?? [];
  if (payload.status === "no_target") {
    return (
      <Notice title="この条件では対象外です" tone="info">
        {rankAnalysisAvailabilityText(payload)}
      </Notice>
    );
  }
  return (
    <>
      <div className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-3">
        <DetailFact
          label="分析範囲"
          value={`${payload.heldEventCount}開催・${payload.matchCount}戦`}
        />
        <DetailFact label="読み取り改善" value={`5回中${payload.improvedFoldCount}回`} />
        <div className="grid gap-1">
          <span className="text-xs text-[var(--color-text-secondary)]">品質</span>
          <div className="flex min-h-6 items-center gap-2">
            <StatusBadge status={payload.status} />
            {payload.status === "ok" ? (
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">安定</span>
            ) : null}
          </div>
        </div>
      </div>
      <div
        aria-label="確認1から5の読み方"
        className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
      >
        <p className="text-xs font-semibold text-[var(--color-text-primary)]">確認1〜5とは</p>
        <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
          対象開催を重ならない5組に分け、毎回1組を手掛かりの計算から外し、外した開催でも同じ読み方が通用するか確かめた5回です。表では、その回に外した開催数と、そこで確かめた2人組の数を示します。
        </p>
      </div>
      {signals.length === 0 ? (
        <EmptyState
          description="開催回をまたいで確認できる手掛かりはありません。"
          title="安定した手掛かりなし"
        />
      ) : (
        <div className="grid gap-3">
          {signals.map((signal) => (
            <article
              className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
              key={signal.signal}
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {rankSignalLabel(signal.signal)}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
                    {rankSignalDirectionLabel(signal)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-[var(--color-text-secondary)]">全体の結びつき</p>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                    {formatDecimal(signal.importance, 3)}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-[var(--radius-xs)] border border-[var(--color-border)]">
                <table className="w-full min-w-[34rem] border-collapse text-sm">
                  <caption className="sr-only">
                    {rankSignalLabel(signal.signal)}の確認1から5
                  </caption>
                  <thead>
                    <tr>
                      <DrilldownTableHeader>確認回</DrilldownTableHeader>
                      <DrilldownTableHeader align="right">外した開催</DrilldownTableHeader>
                      <DrilldownTableHeader align="right">順位の組比較</DrilldownTableHeader>
                      <DrilldownTableHeader align="right">結びつき</DrilldownTableHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {(signal.foldRows ?? []).map((row) => (
                      <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.fold}>
                        <DrilldownTableCell>確認{row.fold + 1}</DrilldownTableCell>
                        <DrilldownTableCell align="right">
                          {row.heldEventCount}開催
                        </DrilldownTableCell>
                        <DrilldownTableCell align="right">
                          {row.comparisonCount}組
                        </DrilldownTableCell>
                        <DrilldownTableCell align="right">
                          {formatDecimal(row.importance, 3)}
                        </DrilldownTableCell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="text-xs leading-5 text-pretty text-[var(--color-text-muted)]">
        「結びつき」は、その記録を開催回単位で入れ替えたときに順位の読み取りがどれだけ崩れたかです。因果や次戦の勝率は表しません。
      </p>
    </>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
        {value}
      </span>
    </div>
  );
}

function RankSignalsPayloadNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <DrilldownLoadNotice
      description="順位の手掛かりの形式が想定と異なります。"
      title="詳細を表示できません"
      onRetry={onRetry}
    />
  );
}
