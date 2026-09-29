import { PlayerRadarChart } from "@/features/seriesComparison/charts/PlayerRadarChart";
import {
  AnalysisReadingGuide,
  AnalysisSection,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import { orderFixedMembers } from "@/shared/domain/members";
import { formatDateOnly, formatDateTimeLong } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
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
      <p className={contentText.compactPrimary}>
        {playerRadarScoreLabel(cell)}
        {cell?.sampleQuality === "reference" && cell.score !== null ? (
          <span className={cn(contentText.supporting, "ml-2")}>参考値</span>
        ) : null}
      </p>
      <p>{cell ? formatPlayerRadarRawValue(cell.axisId, cell.rawValue) : "—"}</p>
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
  const hasReferenceScores = players.some((player) =>
    player.axes.some((axis) => axis.sampleQuality === "reference" && axis.score !== null),
  );
  return (
    <AnalysisSection id="metric-player-radar" title="プレーヤーレーダー">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <div
            aria-label="レーダーの使用基準"
            className={cn(contentText.supporting, "flex flex-wrap gap-x-4 gap-y-1 tabular-nums")}
          >
            <span className={radar.basis ? undefined : contentText.body}>
              作品共通・
              {radar.basis
                ? radar.basis.appliedAt
                  ? `${formatDateOnly(radar.basis.appliedAt)}適用`
                  : "適用日時未取得"
                : "基準未適用"}
            </span>
            <span>1〜10点・外側ほど好成績</span>
          </div>
          {radar.sample.quality === "insufficient" || hasReferenceScores ? (
            <p className={cn(contentText.body, readableTextWidthClass)}>
              {radar.sample.matchCount}戦・{radar.sample.heldEventCount}開催。
              {radar.sample.quality === "insufficient"
                ? "3戦未満のため未採点です。"
                : "参考値のため白抜き・破線で表示しています。"}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {players.map((player) => (
            <PlayerRadarChart key={player.memberId} player={player} />
          ))}
        </div>
        <Disclosure
          ariaLabel="プレーヤーレーダーの数値を表で見る"
          panelSpacing="sm"
          summary="数値を表で見る"
          triggerVariant="supporting"
        >
          <div className="grid min-w-0 gap-3">
            <p className={cn(contentText.supporting, "tabular-nums")}>
              対象 {radar.sample.matchCount}戦・{radar.sample.heldEventCount}開催
            </p>
            <DataTable
              caption={{ content: "6軸の点数と元の成績" }}
              columns={[
                {
                  header: "観点",
                  key: "axis",
                  rowHeader: true,
                  minWidth: "9rem",
                  renderCell: (axis) => axis.label,
                },
                ...players.map((player) => ({
                  header: (
                    <MemberSequenceLabel memberId={player.memberId}>
                      {player.displayName}
                    </MemberSequenceLabel>
                  ),
                  key: player.memberId,
                  minWidth: "10rem",
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
        </Disclosure>
        <AnalysisReadingGuide
          ariaLabel="レーダーの読み方"
          items={[
            ...playerRadarAxes.map((axis) => ({
              id: axis.id,
              label: axis.label,
              value: axis.description,
            })),
            {
              id: "comparison",
              label: "比べ方",
              value:
                "同じ軸で4人を比べます。順位・物件収益・総資産には関連があり、異なる軸の1点差は同じ成績差を表しません。",
            },
            {
              id: "values",
              label: "元の成績の集計",
              value: "P10・P90は値の間を補間し、0円・負の総資産も集計に含めます。",
            },
            {
              id: "quality",
              label: "参考値",
              value:
                "3試合から採点し、40試合未満または8開催未満は参考値です。少数の試合ではP10・P90は最低額・最高額に近づきます。",
            },
          ]}
        />
        {radar.basis ? (
          <Disclosure
            ariaLabel="レーダーの採点基準"
            summary="採点基準"
            panelSpacing="sm"
            panelPadding="sm"
            triggerVariant="supporting"
          >
            <div className="grid gap-4">
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
              <p className={cn(contentText.body, readableTextWidthClass)}>
                シーズン・マップを絞っても基準は共通です。マップ構成で成績の分布は変わるため、同じ条件で比べます。
              </p>
              <DataTable
                caption={{ content: "点数が上がる境界" }}
                columns={[
                  {
                    header: "観点",
                    key: "axis",
                    rowHeader: true,
                    minWidth: "9rem",
                    renderCell: (axis) => axis.label,
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
                      return threshold
                        ? formatPlayerRadarBoundary(axis.id, threshold.rawValue)
                        : "—";
                    },
                  })),
                ]}
                density="compact"
                getRowKey={(axis) => axis.id}
                rows={[...playerRadarAxes]}
                stickyRowHeader
              />
              <p className={cn(contentText.body, readableTextWidthClass)}>
                どの境界にも届かない場合は1点、境界と同じ値なら高い側の点数です。
                「約」は表示用に丸めた境界です。採点には丸める前の値を使います。
              </p>
              <p className={cn(contentText.body, readableTextWidthClass)}>
                基準作成時点の記録を20試合ずつ1試合刻みで集計し、分布の中央と広がりから境界を作ります。
              </p>
            </div>
          </Disclosure>
        ) : null}
      </div>
    </AnalysisSection>
  );
}
