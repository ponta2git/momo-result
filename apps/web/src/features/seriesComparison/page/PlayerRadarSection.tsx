import { PlayerRadarChart } from "@/features/seriesComparison/charts/PlayerRadarChart";
import { AnalysisSection } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import { orderFixedMembers } from "@/shared/domain/members";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { PlayerRadarAxisLabel } from "@/shared/seriesAnalysis/PlayerRadarAxisLabel";
import {
  formatPlayerRadarBoundary,
  formatPlayerRadarRawValue,
  playerRadarAxes,
  playerRadarScoreLabel,
  playerRadarScoresAreReference,
  playerRadarUnavailableLabel,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import type {
  PlayerRadarCell,
  PlayerRadarDisplay,
  PlayerRadarUnavailableReason,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { FactList } from "@/shared/ui/data/FactList";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

function RadarValue({
  cell,
  sharedReasons,
  referenceScoresGrouped,
}: {
  cell: PlayerRadarCell | undefined;
  sharedReasons: readonly PlayerRadarUnavailableReason[];
  referenceScoresGrouped: boolean;
}) {
  const reasons = cell?.scoreUnavailableReasons.filter((reason) => !sharedReasons.includes(reason));
  return (
    <div className="grid gap-1">
      <p className={cn(contentText.compactPrimary, "whitespace-nowrap")}>
        {playerRadarScoreLabel(cell)}
        {!referenceScoresGrouped && cell?.sampleQuality === "reference" && cell.score !== null ? (
          <span className={cn(contentText.supporting, "ml-2")}>参考値</span>
        ) : null}
      </p>
      <p className="whitespace-nowrap">
        {cell ? formatPlayerRadarRawValue(cell.axisId, cell.rawValue) : "—"}
      </p>
      {reasons?.length ? (
        <p className={contentText.supporting}>
          {reasons.map(playerRadarUnavailableLabel).join("・")}
        </p>
      ) : null}
    </div>
  );
}

export function PlayerRadarSection({ radar }: { radar: PlayerRadarDisplay }) {
  const players = orderFixedMembers(radar.players);
  const hasScores = players.some((player) => player.axes.some((axis) => axis.score !== null));
  const cells = players.flatMap((player) => player.axes);
  const referenceScoresGrouped = playerRadarScoresAreReference(players);
  const referenceReasons = [
    radar.sample.matchCount < 40 ? "40試合未満" : null,
    radar.sample.heldEventCount < 8 ? "8開催未満" : null,
  ].filter(Boolean);
  const sharedReasons = (cells[0]?.scoreUnavailableReasons ?? []).filter(
    (reason) =>
      cells.every((cell) => cell.scoreUnavailableReasons.includes(reason)) &&
      (reason === "insufficient_matches" || (reason === "basis_unavailable" && !radar.basis)),
  );
  return (
    <AnalysisSection
      id="metric-player-radar"
      title="プレーヤーレーダー"
      meta={
        <p
          aria-label="レーダーの使用基準"
          className={cn(radar.basis ? contentText.supporting : contentText.body, "tabular-nums")}
        >
          作品共通・
          {radar.basis
            ? radar.basis.appliedAt
              ? `${formatDateOnly(radar.basis.appliedAt)}適用`
              : "適用日時未取得"
            : "基準未適用"}
        </p>
      }
    >
      <div className="grid gap-4">
        {referenceScoresGrouped ? (
          <div className="flex flex-wrap items-center gap-2">
            <SeriesAnalysisQualityAdvisory status="reference" />
            {referenceReasons.length > 0 ? (
              <p className={contentText.supporting}>{referenceReasons.join("・")}</p>
            ) : null}
          </div>
        ) : null}
        {sharedReasons.includes("insufficient_matches") ? (
          <p className={cn(contentText.body, readableTextWidthClass)}>3試合未満のため未採点</p>
        ) : null}
        {hasScores ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-4">
            {players.map((player) => (
              <div className="w-full max-w-sm min-w-0" key={player.memberId}>
                <PlayerRadarChart player={player} referenceScoresGrouped={referenceScoresGrouped} />
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid min-w-0">
          <Disclosure
            ariaLabel="プレーヤーレーダーの数値を表で見る"
            panelSpacing="sm"
            summary="数値を表で見る"
            triggerVariant="supporting"
            defaultOpen={!hasScores}
          >
            <DataTable
              caption={{ content: "6軸の点数と元の成績" }}
              columns={[
                {
                  header: "観点",
                  key: "axis",
                  rowHeader: true,
                  minWidth: "7rem",
                  renderCell: (axis) => <PlayerRadarAxisLabel label={axis.label} />,
                },
                ...players.map((player) => ({
                  header: (
                    <MemberSequenceLabel memberId={player.memberId}>
                      {player.displayName}
                    </MemberSequenceLabel>
                  ),
                  key: player.memberId,
                  minWidth: "8.5rem",
                  tabular: true,
                  renderCell: (axis: (typeof playerRadarAxes)[number]) => (
                    <RadarValue
                      cell={player.axes.find((cell) => cell.axisId === axis.id)}
                      sharedReasons={sharedReasons}
                      referenceScoresGrouped={referenceScoresGrouped}
                    />
                  ),
                })),
              ]}
              density="compact"
              getRowKey={(axis) => axis.id}
              rows={[...playerRadarAxes]}
              stickyRowHeader
              verticalAlign="top"
            />
          </Disclosure>
          <Disclosure
            ariaLabel="レーダーの採点基準"
            summary="採点基準"
            triggerVariant="supporting"
            panelSpacing="sm"
          >
            <div className="grid min-w-0 gap-4">
              <div className={cn(readableTextWidthClass, "px-3")}>
                <FactList
                  ariaLabel="採点対象"
                  items={[
                    {
                      id: "quality",
                      label: "採点対象",
                      value: "3試合以上（40試合未満または8開催未満は参考値）",
                    },
                  ]}
                />
              </div>
              {radar.basis ? (
                <DataTable
                  caption={{ content: "点数の境界" }}
                  columns={[
                    {
                      header: "観点",
                      key: "axis",
                      rowHeader: true,
                      minWidth: "7rem",
                      renderCell: (axis) => <PlayerRadarAxisLabel label={axis.label} />,
                    },
                    ...Array.from({ length: 9 }, (_, index) => index + 2).map((score) => ({
                      header: `${score}点`,
                      key: `score-${score}`,
                      tabular: true,
                      minWidth: "9rem",
                      renderCell: (axis: (typeof playerRadarAxes)[number]) => {
                        const threshold = radar.basis?.axes
                          .find((entry) => entry.axisId === axis.id)
                          ?.thresholds.find((entry) => entry.score === score);
                        return (
                          <span className="whitespace-nowrap">
                            {threshold
                              ? formatPlayerRadarBoundary(axis.id, threshold.rawValue)
                              : "—"}
                          </span>
                        );
                      },
                    })),
                  ]}
                  density="compact"
                  getRowKey={(axis) => axis.id}
                  rows={[...playerRadarAxes]}
                  stickyRowHeader
                />
              ) : null}
            </div>
          </Disclosure>
        </div>
      </div>
    </AnalysisSection>
  );
}
