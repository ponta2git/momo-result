import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { PlayerRadarAxisLabel } from "@/shared/seriesAnalysis/PlayerRadarAxisLabel";
import {
  formatPlayerRadarBoundary,
  playerRadarAxes,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import type { PlayerRadarBasis } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { contentText } from "@/shared/ui/typography";

export function PlayerRadarCriteria({
  currentBasis,
  proposedBasis,
}: {
  currentBasis: PlayerRadarBasis | null;
  proposedBasis: PlayerRadarBasis | null;
}) {
  const sources = [
    ...(currentBasis ? [{ label: "適用中", basis: currentBasis }] : []),
    ...(proposedBasis ? [{ label: "変更案", basis: proposedBasis }] : []),
  ];
  if (sources.length === 0) return null;

  return (
    <div className="grid min-w-0">
      <div className="grid min-w-0 gap-4">
        {proposedBasis ? <p className={contentText.body}>適用中 → 変更案（未適用）</p> : null}
        <DataTable
          caption={{ content: proposedBasis ? "採点境界の変更案" : "適用中の採点境界" }}
          columns={[
            {
              key: "score",
              header: "点数",
              minWidth: "4rem",
              rowHeader: true,
              tabular: true,
              renderCell: (score) => `${score}点`,
            },
            ...playerRadarAxes.map((axis) => ({
              key: axis.id,
              header: <PlayerRadarAxisLabel label={axis.label} />,
              minWidth: "10rem",
              tabular: true,
              renderCell: (score: number) => {
                const before = currentBasis?.axes
                  .find((entry) => entry.axisId === axis.id)
                  ?.thresholds.find((entry) => entry.score === score);
                const after = proposedBasis?.axes
                  .find((entry) => entry.axisId === axis.id)
                  ?.thresholds.find((entry) => entry.score === score);
                return (
                  <div className="grid gap-1">
                    <p className="whitespace-nowrap">
                      <span className="sr-only">適用中 </span>
                      {before ? formatPlayerRadarBoundary(axis.id, before.rawValue) : "未適用"}
                    </p>
                    {proposedBasis ? (
                      <p className="whitespace-nowrap">
                        <span aria-hidden="true">→ </span>
                        <span className="sr-only">変更案 </span>
                        <span
                          className={cn(
                            before?.rawValue !== after?.rawValue && contentText.compactPrimary,
                          )}
                        >
                          {after ? formatPlayerRadarBoundary(axis.id, after.rawValue) : "未作成"}
                        </span>
                      </p>
                    ) : null}
                  </div>
                );
              },
            })),
          ]}
          density="compact"
          getRowKey={String}
          rows={Array.from({ length: 9 }, (_, index) => index + 2)}
          stickyRowHeader
          verticalAlign="top"
        />
      </div>
      <Disclosure summary="作成元の記録" triggerVariant="supporting">
        <DataTable
          caption={{ content: "採点基準の作成元" }}
          columns={[
            {
              key: "basis",
              header: "基準",
              minWidth: "5rem",
              rowHeader: true,
              renderCell: (entry) => entry.label,
            },
            {
              key: "created",
              header: "基準作成日時",
              minWidth: "11rem",
              tabular: true,
              renderCell: (entry) =>
                formatDateTimeLong(entry.basis.createdAt ?? undefined, "未取得"),
            },
            {
              key: "sample",
              header: "件数",
              minWidth: "8rem",
              tabular: true,
              renderCell: (entry) =>
                `${entry.basis.source.matchCount}試合・${entry.basis.source.heldEventCount}開催`,
            },
            {
              key: "period",
              header: "期間",
              minWidth: "18rem",
              tabular: true,
              renderCell: (entry) =>
                entry.basis.source.firstPlayedAt && entry.basis.source.lastPlayedAt
                  ? `${formatDateTimeLong(entry.basis.source.firstPlayedAt)}〜${formatDateTimeLong(entry.basis.source.lastPlayedAt)}`
                  : "未取得",
            },
            {
              key: "maps",
              header: "マップ別件数",
              minWidth: "12rem",
              tabular: true,
              renderCell: (entry) =>
                entry.basis.source.maps
                  .map((map) => `${map.displayName} ${map.matchCount}試合`)
                  .join("、") || "未取得",
            },
          ]}
          density="compact"
          getRowKey={(entry) => entry.label}
          rows={sources}
          stickyRowHeader
          verticalAlign="top"
        />
      </Disclosure>
    </div>
  );
}
