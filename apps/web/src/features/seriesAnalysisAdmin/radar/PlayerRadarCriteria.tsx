import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { PlayerRadarAxisLabel } from "@/shared/seriesAnalysis/PlayerRadarAxisLabel";
import {
  formatPlayerRadarBoundary,
  playerRadarAxes,
  achievementCurveThresholds,
  achievementCurveUnit,
  defaultAchievementCurve,
  defaultAchievementPointCurve,
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
  const currentCurve = currentBasis
    ? (currentBasis.achievementCurve ?? defaultAchievementCurve)
    : defaultAchievementPointCurve;
  const proposedCurve = proposedBasis?.achievementCurve ?? defaultAchievementCurve;
  const beforeThresholds = achievementCurveThresholds(currentCurve);
  const afterThresholds = achievementCurveThresholds(proposedCurve);
  const scores = [
    ...new Set([
      ...Array.from({ length: 9 }, (_, index) => index + 2),
      ...[...beforeThresholds, ...(proposedBasis ? afterThresholds : [])].map(
        (entry) => entry.score,
      ),
    ]),
  ].toSorted((a, b) => a - b);

  return (
    <div className="grid min-w-0">
      <div className="grid min-w-0 gap-4">
        {proposedBasis ? <p className={contentText.body}>適用中 → 変更案（未適用）</p> : null}
        <DataTable
          caption={{
            content: proposedBasis ? "採点境界の変更案" : "適用中の採点境界",
            visibility: "screen-reader",
          }}
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
                      {proposedBasis ? <span className="sr-only">適用中 </span> : null}
                      {before
                        ? formatPlayerRadarBoundary(axis.id, before.rawValue)
                        : currentBasis
                          ? "—"
                          : "未適用"}
                    </p>
                    {proposedBasis && before?.rawValue !== after?.rawValue ? (
                      <p className="whitespace-nowrap">
                        <span aria-hidden="true">→ </span>
                        <span className="sr-only">変更案 </span>
                        <span
                          className={cn(
                            before?.rawValue !== after?.rawValue && contentText.compactPrimary,
                          )}
                        >
                          {after ? formatPlayerRadarBoundary(axis.id, after.rawValue) : "—"}
                        </span>
                      </p>
                    ) : null}
                  </div>
                );
              },
            })),
            {
              key: "achievement",
              header: <PlayerRadarAxisLabel label="実績達成" />,
              minWidth: "10rem",
              tabular: true,
              renderCell: (score: number) => {
                const before = beforeThresholds.find((entry) => entry.score === score)?.rawValue;
                const after = afterThresholds.find((entry) => entry.score === score)?.rawValue;
                const beforeUnit = achievementCurveUnit(currentCurve);
                const afterUnit = achievementCurveUnit(proposedCurve);
                const changed = before !== after || beforeUnit !== afterUnit;
                return (
                  <div className="grid gap-1 whitespace-nowrap">
                    <p>
                      {proposedBasis ? (
                        <span className="sr-only">{currentBasis ? "適用中 " : "初期値 "}</span>
                      ) : null}
                      {before === undefined ? "—" : `${before}${beforeUnit}`}
                    </p>
                    {proposedBasis && changed ? (
                      <p className={contentText.compactPrimary}>
                        <span aria-hidden="true">→ </span>
                        <span className="sr-only">変更案 </span>
                        {after === undefined ? "—" : `${after}${afterUnit}`}
                      </p>
                    ) : null}
                  </div>
                );
              },
            },
          ]}
          density="compact"
          getRowKey={String}
          rows={scores}
          scrollArea={{
            label: proposedBasis ? "採点境界の変更案" : "適用中の採点境界",
            showHint: false,
          }}
          stickyRowHeader
          verticalAlign="top"
        />
        <p className={contentText.supporting}>
          実績達成は作品通算で採点します。ポイント基準は境界以上で点数が上がります。
          {"thresholds" in currentCurve || (proposedBasis && "thresholds" in proposedCurve)
            ? "従来の得点率基準は基準点の間を直線で補間します。"
            : ""}
        </p>
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
