import {
  defaultOwnerMetric,
  isOwnerMetricId,
  ownerMetricOptions,
  ownerMetricPresentation,
} from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import type {
  OwnerCell,
  OwnerComparison,
  OwnerMetricId,
} from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import { formatPercent } from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { AnalysisSection } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import type { DataTableColumn } from "@/shared/ui/data/DataTable";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { SelectControl } from "@/shared/ui/forms/SelectControl";
import { rankColor } from "@/shared/ui/rank/rankPresentation";
import { contentText } from "@/shared/ui/typography";

type OwnerRow = OwnerComparison["rows"][number];

/** Narrow the wire union once; no child needs to know the artifact generation. */
export function SeriesAnalysisOwnerComparison({
  response,
  metric = defaultOwnerMetric,
  onMetricChange,
}: {
  response: SeriesComparisonAggregate;
  metric?: OwnerMetricId;
  onMetricChange?: ((metric: OwnerMetricId) => void) | undefined;
}) {
  const comparison = response.schemaVersion === 4 ? response.ownerComparison : undefined;
  return (
    <AnalysisSection id="metric-owner" title="オーナー比較">
      <div className="grid min-w-0 gap-4">
        <div className="max-w-sm">
          <SelectControl
            aria-label="オーナー比較の指標"
            value={metric}
            options={ownerMetricOptions}
            disabled={!comparison || response.scope.matchCount === 0}
            onValueChange={(value) => {
              if (isOwnerMetricId(value)) onMetricChange?.(value);
            }}
          />
        </div>
        {comparison && response.scope.matchCount === 0 ? (
          <EmptyState
            placement="embedded"
            title="対象の試合がありません"
            description="作品やシーズン、マップの条件を変えてください。"
          />
        ) : comparison ? (
          <>
            {comparison.recordedOwnerCount === 1 ? (
              <p className={cn(contentText.supporting, "max-w-2xl text-pretty")}>
                この条件では、オーナーの記録は1人分です。
              </p>
            ) : null}
            <OwnerTable comparison={comparison} metric={metric} />
          </>
        ) : (
          <p className={cn(contentText.body, "max-w-2xl text-pretty")}>
            この分析にはオーナー別の集計がありません。新しい分析が完成すると表示されます。
          </p>
        )}
      </div>
    </AnalysisSection>
  );
}

function OwnerTable({
  comparison,
  metric,
}: {
  comparison: OwnerComparison;
  metric: OwnerMetricId;
}) {
  const definition = ownerMetricPresentation(metric);
  const columns: Array<DataTableColumn<OwnerRow>> = [
    {
      key: "player",
      header: "プレーヤー / オーナー",
      rowHeader: true,
      width: "7rem",
      minWidth: "7rem",
      renderCell: (row) => (
        <MemberSequenceLabel memberId={row.memberId}>
          <span className="wrap-anywhere">{row.displayName}</span>
        </MemberSequenceLabel>
      ),
    },
    ...comparison.owners.map((owner): DataTableColumn<OwnerRow> => ({
      key: owner.memberId,
      minWidth: "9rem",
      align: "right",
      tabular: true,
      header: (
        <div className="grid gap-1">
          <span className="wrap-anywhere">{owner.displayName}</span>
          <span>{owner.targetCount}戦</span>
          {owner.qualityStatus === "ok" ? null : (
            <span className="flex justify-end">
              <SeriesAnalysisQualityAdvisory status={owner.qualityStatus} />
            </span>
          )}
        </div>
      ),
      renderCell: (row) => {
        const cell = row.cells.find((value) => value.ownerMemberId === owner.memberId);
        if (!cell || owner.targetCount === 0) return <span aria-label="対象なし">—</span>;
        return <OwnerValue cell={cell} metric={metric} />;
      },
    })),
  ];
  return (
    <DataTable
      caption={{ content: `オーナー別の${definition.label}` }}
      columns={columns}
      rows={comparison.rows}
      getRowKey={(row) => row.memberId}
      stickyRowHeader
      minWidth="43rem"
      layout="fixed"
      scrollArea={{ label: `オーナー別の${definition.label}の表`, maxHeight: "min(32rem, 65dvh)" }}
    />
  );
}

function OwnerValue({ cell, metric }: { cell: OwnerCell; metric: OwnerMetricId }) {
  const definition = ownerMetricPresentation(metric);
  if (metric === "rank.distribution")
    return (
      <div className="grid gap-2">
        <div aria-hidden="true" className="flex h-2 overflow-hidden">
          {cell.rank.distribution.map((rank) => (
            <span
              key={rank.rank}
              style={{ backgroundColor: rankColor(rank.rank), width: `${(rank.rate ?? 0) * 100}%` }}
            />
          ))}
        </div>
        <ul className={cn(contentText.compactPrimary, "grid gap-1 tabular-nums")}>
          {cell.rank.distribution.map((rank) => (
            <li key={rank.rank}>
              {rank.rank}位 {rank.count}回{" "}
              <span className={contentText.supporting}>（{formatPercent(rank.rate)}）</span>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="grid gap-1">
      <span className={cn(contentText.compactPrimary, "wrap-anywhere tabular-nums")}>
        {definition.value(cell)}
      </span>
      {definition.detail ? (
        <span className={contentText.supporting}>{definition.detail(cell)}</span>
      ) : null}
    </div>
  );
}
