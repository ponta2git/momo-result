import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

import {
  DrilldownContentSkeleton,
  DrilldownLoadNotice,
  DrilldownPlayerSelector,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownPrimitives";
import type {
  UnexpectedWinRow,
  UnexpectedWinsDrilldownPayload,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonRankAnalysisDrilldownTypes";
import { useSeriesComparisonDrilldownQuery } from "@/features/seriesComparison/drilldowns/useSeriesComparisonDrilldownQuery";
import { StatusBadge } from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import {
  formatDecimal,
  formatMoney,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import { rankAnalysisAvailabilityText } from "@/features/seriesComparison/model/seriesComparisonRankAnalysis";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { formatDateTimeCompact } from "@/shared/lib/dateTime";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { useCurrentLocationPath } from "@/shared/navigation/useCurrentLocationPath";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

export function UnexpectedWinsDrilldownDialog({
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
    metricId: "rankAnalysis.unexpectedWins",
    open,
    response,
    selectedMemberId,
  });
  const data = drilldownQuery.data;
  const payload = data?.unexpectedWins;
  const loading = open && isInitialQueryLoading(drilldownQuery);
  const showError = shouldShowBlockingQueryError(drilldownQuery);
  const showCachedError = Boolean(data && shouldShowQueryError(drilldownQuery));
  const retry = () => void drilldownQuery.refetch();
  const title = selectedPlayer ? `記録外の一撃: ${selectedPlayer.displayName}` : "記録外の一撃";

  return (
    <Dialog
      className="flex h-full min-h-0 flex-col"
      description="保存済み記録からの推定と実際の1位が大きく違った試合を、対戦順に確認します。"
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
          <DrilldownContentSkeleton label="記録外の一撃を読み込み中" />
        ) : showError ? (
          <DrilldownLoadNotice
            description="記録外の一撃の取得に失敗しました。通信状態を確認して、もう一度お試しください。"
            pending={drilldownQuery.isFetching}
            title="詳細を表示できません"
            onRetry={retry}
          />
        ) : data ? (
          <StaleShield
            active={drilldownQuery.isFetching}
            busyLabel="記録外の一撃を更新中"
            className="h-full min-h-0"
            contentClassName="h-full min-h-0"
            fallback={<DrilldownContentSkeleton label="記録外の一撃を読み込み中" />}
            preserveContent
          >
            <div className="grid h-full min-h-0 gap-3 overflow-y-auto overscroll-contain pr-1">
              {showCachedError ? (
                <DrilldownLoadNotice
                  description="直前に取得した詳細を表示しています。"
                  title="最新の詳細を取得できません"
                  tone="warning"
                  onRetry={retry}
                />
              ) : null}
              {payload ? (
                <UnexpectedWinsDetails payload={payload} />
              ) : (
                <UnexpectedPayloadNotice onRetry={retry} />
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

function UnexpectedWinsDetails({ payload }: { payload: UnexpectedWinsDrilldownPayload }) {
  const rows = (payload.rows ?? []).toSorted((left, right) => left.matchIndex - right.matchIndex);
  if (payload.status === "no_target") {
    return (
      <Notice title="この条件では対象外です" tone="info">
        {rankAnalysisAvailabilityText(payload)}
      </Notice>
    );
  }
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
        <StatusBadge status={payload.status} />
        <p className="text-sm text-[var(--color-text-secondary)] tabular-nums">
          <span className="font-semibold text-[var(--color-text-primary)]">
            {payload.unexpectedWinCount}回
          </span>
          {" / "}
          {payload.totalWinCount}勝
        </p>
        <p className="text-xs text-[var(--color-text-secondary)] tabular-nums">
          {payload.heldEventCount}開催・{payload.matchCount}戦
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          description="保存済み記録だけでは下位寄りに見えた1位はありません。"
          title="該当試合なし"
        />
      ) : (
        <ol className="grid gap-3" aria-label="記録外の一撃の対戦履歴">
          {rows.map((row) => (
            <UnexpectedWinCard key={row.matchId} row={row} />
          ))}
        </ol>
      )}
      <p className="text-xs leading-5 text-pretty text-[var(--color-text-muted)]">
        推定順位はその開催回を学習に含めず計算しています。運や隠れた実力の判定ではありません。
      </p>
    </>
  );
}

function UnexpectedWinCard({ row }: { row: UnexpectedWinRow }) {
  const returnTo = useCurrentLocationPath();
  const evidence = row.evidence;
  const facts = [
    ["物件収益", formatMoney(evidence.revenueManYen)],
    ["目的地", `${evidence.destinationCount}回`],
    ["プラス駅", `${evidence.plusStationCount}回`],
    ["マイナス駅", `${evidence.minusStationCount}回`],
    ["カード駅", `${evidence.cardStationCount}回`],
    ["カード売り場", `${evidence.cardShopCount}回`],
    ["スリの銀次", `${evidence.ginjiCount}回`],
  ];
  return (
    <li className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
            {row.matchIndex}戦目・第{row.matchNoInEvent}試合
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {formatDateTimeCompact(row.playedAt)} 開催
          </p>
        </div>
        <p className="text-base font-semibold text-[var(--color-text-primary)] tabular-nums">
          推定{formatDecimal(row.expectedRank, 1)}位 → 実際{row.actualRank}位
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {facts.map(([label, value]) => (
          <div
            className="rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-2 py-1"
            key={label}
          >
            <dt className="text-[10px] text-[var(--color-text-secondary)]">{label}</dt>
            <dd className="mt-0.5 text-xs font-semibold text-[var(--color-text-primary)] tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <Link
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-[var(--color-action)] underline-offset-4 hover:underline"
        to={withReturnTo(`/matches/${encodeURIComponent(row.matchId)}`, returnTo)}
      >
        この試合の結果
        <ArrowUpRight aria-hidden="true" className="size-4" />
      </Link>
    </li>
  );
}

function UnexpectedPayloadNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <DrilldownLoadNotice
      description="記録外の一撃の形式が想定と異なります。"
      title="詳細を表示できません"
      onRetry={onRetry}
    />
  );
}
