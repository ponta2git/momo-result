import { PlayerRadarChart } from "@/features/seriesComparison/charts/PlayerRadarChart";
import { AnalysisSection } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import { orderFixedMembers } from "@/shared/domain/members";
import { formatDateOnly, formatDateTimeLong } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { PlayerRadarAxisLabel } from "@/shared/seriesAnalysis/PlayerRadarAxisLabel";
import {
  formatPlayerRadarBoundary,
  formatPlayerRadarRawValue,
  playerRadarAxes,
  playerRadarScoreLabel,
  playerRadarUnavailableLabel,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import type {
  PlayerRadarCell,
  PlayerRadarDisplay,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { FactList } from "@/shared/ui/data/FactList";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

function RadarValue({ cell }: { cell: PlayerRadarCell | undefined }) {
  return (
    <div className="grid gap-1">
      <p className={cn(contentText.compactPrimary, "whitespace-nowrap")}>
        {playerRadarScoreLabel(cell)}
        {cell?.sampleQuality === "reference" && cell.score !== null ? (
          <span className={cn(contentText.supporting, "ml-2")}>参考値</span>
        ) : null}
      </p>
      <p className="whitespace-nowrap">
        {cell ? formatPlayerRadarRawValue(cell.axisId, cell.rawValue) : "—"}
      </p>
      {cell?.scoreUnavailableReasons.length ? (
        <p className={contentText.supporting}>
          {cell.scoreUnavailableReasons.map(playerRadarUnavailableLabel).join("・")}
        </p>
      ) : null}
    </div>
  );
}

export function PlayerRadarSection({ radar }: { radar: PlayerRadarDisplay }) {
  const players = orderFixedMembers(radar.players);
  const hasScores = players.some((player) => player.axes.some((axis) => axis.score !== null));
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
        {radar.sample.quality === "insufficient" ? (
          <p className={cn(contentText.body, readableTextWidthClass)}>
            未採点：対象{radar.sample.matchCount}試合・{radar.sample.heldEventCount}
            開催（3試合から採点）
          </p>
        ) : null}
        {hasScores ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {players.map((player) => (
              <div className="w-full max-w-sm min-w-0" key={player.memberId}>
                <PlayerRadarChart player={player} />
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
            triggerLayout="flush-horizontal"
            defaultOpen={!hasScores}
          >
            <div className="grid min-w-0 gap-3">
              <p className={cn(contentText.supporting, "tabular-nums")}>
                対象{radar.sample.matchCount}戦・{radar.sample.heldEventCount}開催
              </p>
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
                      <RadarValue cell={player.axes.find((cell) => cell.axisId === axis.id)} />
                    ),
                  })),
                ]}
                density="compact"
                getRowKey={(axis) => axis.id}
                rows={[...playerRadarAxes]}
                stickyRowHeader
                verticalAlign="top"
              />
              <div className={readableTextWidthClass}>
                <FactList
                  ariaLabel="表示対象の記録範囲"
                  columns={2}
                  items={[
                    {
                      id: "period",
                      label: "対象期間",
                      value:
                        radar.sample.firstPlayedAt && radar.sample.lastPlayedAt
                          ? `${formatDateTimeLong(radar.sample.firstPlayedAt)}〜${formatDateTimeLong(radar.sample.lastPlayedAt)}`
                          : "対象なし",
                    },
                    {
                      id: "maps",
                      label: "マップ別件数",
                      value:
                        radar.sample.maps
                          .map((map) => `${map.displayName} ${map.matchCount}試合`)
                          .join("、") || "対象なし",
                    },
                  ]}
                />
              </div>
            </div>
          </Disclosure>
          <Disclosure
            ariaLabel="レーダーの指標と採点基準"
            summary="指標と採点基準"
            triggerVariant="supporting"
            triggerLayout="flush-horizontal"
            panelSpacing="sm"
          >
            <div className="grid min-w-0 gap-4">
              <div className={readableTextWidthClass}>
                <FactList
                  ariaLabel="指標の定義"
                  columns={2}
                  items={playerRadarAxes.map((axis) => ({
                    id: axis.id,
                    label: axis.label,
                    value: axis.description,
                  }))}
                />
              </div>
              <div className={readableTextWidthClass}>
                <FactList
                  ariaLabel="採点方法"
                  items={[
                    {
                      id: "scale",
                      label: "点数",
                      value: "1〜10点。平均順位は小さいほど、金額は大きいほど高得点。",
                    },
                    {
                      id: "values",
                      label: "P10・P90",
                      value: "値の間は補間します。少数の試合では最低額・最高額に近づきます。",
                    },
                    {
                      id: "quality",
                      label: "採点対象",
                      value: "3試合以上（40試合未満または8開催未満は参考値）",
                    },
                  ]}
                />
              </div>
              {radar.basis ? (
                <Disclosure
                  ariaLabel="レーダーの点数の境界"
                  summary="点数の境界"
                  panelSpacing="sm"
                  triggerVariant="supporting"
                  triggerLayout="flush-horizontal"
                >
                  <div className="grid gap-4">
                    <div className={readableTextWidthClass}>
                      <FactList
                        ariaLabel="使用基準の作成元"
                        columns={2}
                        items={[
                          {
                            id: "source",
                            label: "基準の作成元",
                            value: `作品の全期間・全マップから${radar.basis.source.matchCount}試合・${radar.basis.source.heldEventCount}開催`,
                          },
                          {
                            id: "source-period",
                            label: "作成元の対象期間",
                            value:
                              radar.basis.source.firstPlayedAt && radar.basis.source.lastPlayedAt
                                ? `${formatDateTimeLong(radar.basis.source.firstPlayedAt)}〜${formatDateTimeLong(radar.basis.source.lastPlayedAt)}`
                                : "対象なし",
                          },
                          {
                            id: "source-maps",
                            label: "作成元のマップ別件数",
                            value:
                              radar.basis.source.maps
                                .map((map) => `${map.displayName} ${map.matchCount}試合`)
                                .join("、") || "対象なし",
                          },
                          {
                            id: "created",
                            label: "基準作成日時",
                            value: formatDateTimeLong(radar.basis.createdAt ?? undefined, "未取得"),
                          },
                          {
                            id: "applied",
                            label: "適用日時",
                            value: formatDateTimeLong(radar.basis.appliedAt ?? undefined, "未適用"),
                          },
                        ]}
                      />
                    </div>
                    <DataTable
                      caption={{ content: "点数が上がる境界" }}
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
                    <p className={cn(contentText.body, readableTextWidthClass)}>
                      2点の条件を満たさない場合は1点です。「約」は表示用の丸めで、採点には元の値を使います。
                    </p>
                    <p className={cn(contentText.body, readableTextWidthClass)}>
                      20試合ごとの集計を1試合ずつずらし、分布の中央と広がりから境界を作ります。
                    </p>
                  </div>
                </Disclosure>
              ) : null}
            </div>
          </Disclosure>
        </div>
      </div>
    </AnalysisSection>
  );
}
