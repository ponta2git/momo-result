import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import type { Player } from "@/features/seriesComparison/seriesComparisonPresentation";
import { formatDecimal, isNumber } from "@/features/seriesComparison/seriesComparisonPresentation";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { seriesComparisonKeys } from "@/shared/api/queryKeys";
import { getSeriesComparisonDrilldown } from "@/shared/api/seriesComparison";
import type {
  SeriesComparisonDrilldownQuery,
  SeriesComparisonDrilldownResponse,
  SeriesComparisonResponse,
} from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

type DrilldownView = "events" | "matches";
type MatchRow = NonNullable<SeriesComparisonDrilldownResponse["matchRows"]>[number];
type EventRow = NonNullable<SeriesComparisonDrilldownResponse["heldEventRows"]>[number];

export function RankAverageHistoryDrilldownDialog({
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
  const [view, setView] = useState<DrilldownView>("events");
  const players = response.players ?? [];
  const selectedPlayer =
    players.find((player) => player.memberId === selectedMemberId) ?? players[0] ?? null;
  const query = useMemo<SeriesComparisonDrilldownQuery | undefined>(() => {
    if (!selectedPlayer) {
      return undefined;
    }
    return {
      gameTitleId: response.scope.gameTitleId,
      mapMasterId: response.scope.mapMasterId,
      memberId: selectedPlayer.memberId,
      metricId: "rank.averageHistory",
      seasonMasterId: response.scope.seasonMasterId,
    };
  }, [
    response.scope.gameTitleId,
    response.scope.mapMasterId,
    response.scope.seasonMasterId,
    selectedPlayer,
  ]);

  const drilldownQuery = useQuery({
    enabled: open && query !== undefined,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      if (!query) {
        throw new Error("series comparison drilldown query is not ready");
      }
      return getSeriesComparisonDrilldown(query, { signal });
    },
    queryKey: seriesComparisonKeys.drilldown(query),
  });
  const data = drilldownQuery.data;
  const loading = open && isInitialQueryLoading(drilldownQuery);
  const showError = shouldShowBlockingQueryError(drilldownQuery);
  const title = selectedPlayer ? `順位の地力: ${selectedPlayer.displayName}` : "順位の地力";

  return (
    <Dialog
      className="flex h-full min-h-0 flex-col"
      description="選択範囲内の対戦順で、順位と平均順位がどう動いたかを確認します。"
      open={open}
      popupClassName="max-w-[min(92rem,calc(100vw-1rem))] items-stretch p-2 sm:p-4"
      surfaceClassName="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] !overflow-hidden p-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:p-5"
      title={title}
      onOpenChange={onOpenChange}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <PlayerSelector
            players={players}
            selectedMemberId={selectedPlayer?.memberId}
            onMemberChange={onMemberChange}
          />
          <SegmentedControl
            label="履歴表示"
            options={[
              { label: "開催ごと", value: "events" },
              { label: "試合ごと", value: "matches" },
            ]}
            value={view}
            onValueChange={(next) => setView(next as DrilldownView)}
          />
        </div>
        {loading ? (
          <div className="flex min-h-48 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-sm font-medium text-[var(--color-text-secondary)]">
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 size-4 animate-spin motion-reduce:animate-none"
            />
            履歴を読み込み中
          </div>
        ) : showError ? (
          <Notice title="履歴を表示できません" tone="danger">
            順位履歴の取得に失敗しました。時間をおいて再読み込みしてください。
          </Notice>
        ) : data ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
            <RankHistorySummary data={data} />
            {view === "events" ? (
              <HeldEventHistoryTable rows={data.heldEventRows ?? []} />
            ) : (
              <MatchHistoryTable rows={data.matchRows ?? []} />
            )}
          </div>
        ) : (
          <EmptyState
            title="履歴がありません"
            description="プレーヤーを選択すると履歴を取得します。"
          />
        )}
      </div>
    </Dialog>
  );
}

function PlayerSelector({
  players,
  selectedMemberId,
  onMemberChange,
}: {
  players: Player[];
  selectedMemberId: string | undefined;
  onMemberChange: (memberId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {players.map((player, index) => {
        const selected = player.memberId === selectedMemberId;
        return (
          <Button
            key={player.memberId}
            className={cn(
              "justify-start border-l-4",
              selected ? "bg-[var(--color-action)]/10" : "",
            )}
            size="sm"
            style={{ borderLeftColor: playerColor(index) }}
            variant={selected ? "secondary" : "quiet"}
            onClick={() => onMemberChange(player.memberId)}
          >
            {player.displayName}
          </Button>
        );
      })}
    </div>
  );
}

function RankHistorySummary({ data }: { data: SeriesComparisonDrilldownResponse }) {
  const summary = data.summary;
  const facts = [
    { label: "対象戦数", value: `${summary.targetCount}戦` },
    { label: "現在の平均順位", value: formatDecimal(summary.currentAverageRank) },
    {
      label: "直近開催の平均変化",
      value: formatRankAverageDelta(summary.latestHeldEventAverageRankDelta),
    },
  ];
  return (
    <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-3">
      {facts.map((fact) => (
        <div
          className="min-w-0 rounded-[var(--radius-xs)] bg-[var(--color-surface)] px-2.5 py-2"
          key={fact.label}
        >
          <p className="text-[11px] leading-4 text-[var(--color-text-secondary)]">{fact.label}</p>
          <p className="mt-0.5 text-sm font-semibold break-words text-[var(--color-text-primary)] tabular-nums">
            {fact.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function HeldEventHistoryTable({ rows }: { rows: EventRow[] }) {
  const sortedRows = useMemo(() => rows.toSorted(compareEventRowDesc), [rows]);
  if (rows.length === 0) {
    return <EmptyState title="開催ごとの履歴がありません" description="対象試合がありません。" />;
  }
  return (
    <div
      aria-label="開催ごとの順位履歴"
      className="h-full min-h-0 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <table className="w-full min-w-[62rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <TableHeader className="sticky left-0 z-[calc(var(--z-sticky)+1)]">開催</TableHeader>
            <TableHeader align="right">試合数</TableHeader>
            <TableHeader>順位列</TableHeader>
            <TableHeader align="right">開催平均</TableHeader>
            <TableHeader>開催内変動</TableHeader>
            <TableHeader align="right">開催前平均</TableHeader>
            <TableHeader align="right">開催後平均</TableHeader>
            <TableHeader>開催による変動</TableHeader>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.heldEventId}>
              <StickyCell>
                <span className="block font-semibold">{formatDate(row.firstPlayedAt)}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">
                  {shortId(row.heldEventId)}
                </span>
              </StickyCell>
              <TableCell align="right">{row.matchCount}戦</TableCell>
              <TableCell>{(row.ranks ?? []).map((rank) => `${rank}位`).join(" → ")}</TableCell>
              <TableCell align="right">{formatDecimal(row.eventAverageRank)}</TableCell>
              <TableCell>
                <DeltaBadge value={row.eventRankDelta} variant="rank" />
              </TableCell>
              <TableCell align="right">{formatDecimal(row.cumulativeAverageBefore)}</TableCell>
              <TableCell align="right">{formatDecimal(row.cumulativeAverageAfter)}</TableCell>
              <TableCell>
                <DeltaBadge value={row.cumulativeAverageDelta} variant="average" />
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchHistoryTable({ rows }: { rows: MatchRow[] }) {
  const sortedRows = useMemo(() => rows.toSorted(compareMatchRowDesc), [rows]);
  if (rows.length === 0) {
    return <EmptyState title="試合ごとの履歴がありません" description="対象試合がありません。" />;
  }
  return (
    <div
      aria-label="試合ごとの順位履歴"
      className="h-full min-h-0 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <table className="w-full min-w-[64rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <TableHeader className="sticky left-0 z-[calc(var(--z-sticky)+1)]">対戦順</TableHeader>
            <TableHeader>開催</TableHeader>
            <TableHeader align="right">第n試合</TableHeader>
            <TableHeader align="right">順位</TableHeader>
            <TableHeader align="right">前戦順位</TableHeader>
            <TableHeader>順位変動</TableHeader>
            <TableHeader align="right">試合後平均順位</TableHeader>
            <TableHeader>平均順位変動</TableHeader>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.matchId}>
              <StickyCell>
                <span className="font-semibold tabular-nums">{row.matchIndex}戦目</span>
              </StickyCell>
              <TableCell>
                <span className="block">{formatDate(row.playedAt)}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">
                  {shortId(row.heldEventId)}
                </span>
              </TableCell>
              <TableCell align="right">第{row.matchNoInEvent}試合</TableCell>
              <TableCell align="right">{row.rank}位</TableCell>
              <TableCell align="right">
                {isNumber(row.previousRank) ? `${row.previousRank}位` : "初戦"}
              </TableCell>
              <TableCell>
                <DeltaBadge value={row.rankDelta} variant="rank" />
              </TableCell>
              <TableCell align="right">{formatDecimal(row.cumulativeAverageRank)}</TableCell>
              <TableCell>
                <DeltaBadge value={row.cumulativeAverageRankDelta} variant="average" />
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableHeader({
  align = "left",
  children,
  className,
}: {
  align?: "left" | "right";
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "sticky top-0 z-[var(--z-sticky)] border-b border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      scope="col"
    >
      {children}
    </th>
  );
}

function TableCell({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <td
      className={cn(
        "border-b border-[var(--color-border)] px-3 py-2.5 align-top text-[var(--color-text-primary)] tabular-nums group-last:border-b-0",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

function StickyCell({ children }: { children: ReactNode }) {
  return (
    <td className="sticky left-0 z-[var(--z-base)] border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 align-top text-[var(--color-text-primary)] tabular-nums group-last:border-b-0 group-hover:bg-[var(--color-surface-subtle)]">
      {children}
    </td>
  );
}

function DeltaBadge({
  value,
  variant,
}: {
  value: number | null | undefined;
  variant: "average" | "rank";
}) {
  if (!isNumber(value)) {
    return <span className="text-[var(--color-text-muted)]">初戦</span>;
  }
  const tone = value < 0 ? "improve" : value > 0 ? "decline" : "flat";
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-[var(--radius-xs)] border px-2 py-0.5 text-xs font-semibold tabular-nums",
        tone === "improve" &&
          "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-text-primary)]",
        tone === "decline" &&
          "border-[var(--color-review)]/45 bg-[var(--color-review)]/10 text-[var(--color-text-primary)]",
        tone === "flat" &&
          "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
      )}
    >
      {formatDelta(value, variant)} {toneLabel(tone)}
    </span>
  );
}

function formatRankAverageDelta(value: number | null | undefined): string {
  if (!isNumber(value)) {
    return "対象なし";
  }
  return `${formatDelta(value, "average")} ${toneLabel(value < 0 ? "improve" : value > 0 ? "decline" : "flat")}`;
}

function formatDelta(value: number, variant: "average" | "rank"): string {
  const absolute = Math.abs(value);
  return variant === "rank" ? `${Math.trunc(absolute)}位` : absolute.toFixed(2);
}

function toneLabel(tone: "decline" | "flat" | "improve"): string {
  switch (tone) {
    case "improve":
      return "改善";
    case "decline":
      return "後退";
    case "flat":
      return "維持";
  }
}

function compareEventRowDesc(left: EventRow, right: EventRow): number {
  return (
    compareTimestampDesc(left.firstPlayedAt, right.firstPlayedAt) ||
    right.heldEventId.localeCompare(left.heldEventId)
  );
}

function compareMatchRowDesc(left: MatchRow, right: MatchRow): number {
  return (
    compareTimestampDesc(left.playedAt, right.playedAt) ||
    right.matchNoInEvent - left.matchNoInEvent ||
    right.matchIndex - left.matchIndex ||
    right.heldEventId.localeCompare(left.heldEventId) ||
    right.matchId.localeCompare(left.matchId)
  );
}

function compareTimestampDesc(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return right.localeCompare(left);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ja-JP", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}
