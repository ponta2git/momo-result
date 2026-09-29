import { BookOpenText } from "lucide-react";

import { PlayerRadarChart } from "@/features/seriesComparison/charts/PlayerRadarChart";
import { AnalysisSection } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
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
import { ActionLink } from "@/shared/ui/actions/ActionLink";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { FactList } from "@/shared/ui/data/FactList";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

const tableId = "player-radar-values";

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
  return (
    <AnalysisSection id="metric-player-radar" title="6つの観点で成績を比べる">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <div
            aria-label="レーダーの対象と使用基準"
            className={cn(contentText.supporting, "flex flex-wrap gap-x-4 gap-y-1 tabular-nums")}
          >
            <span>
              対象 {radar.sample.matchCount}戦・{radar.sample.heldEventCount}開催
            </span>
            <span>
              作品共通の基準：
              {radar.basis
                ? `${radar.basis.createdAt ? `${formatDateOnly(radar.basis.createdAt)} 作成` : "作成日時未取得"}・${radar.basis.appliedAt ? `${formatDateOnly(radar.basis.appliedAt)} 適用` : "適用日時未取得"}`
                : "未適用"}
            </span>
          </div>
          <ContentWithActions
            actions={
              <ActionLink
                className="min-h-11 w-fit py-2 text-sm text-[var(--color-text-primary)] underline underline-offset-4"
                href={`#${tableId}`}
              >
                数値で比較する
              </ActionLink>
            }
          >
            <p className={cn(contentText.body, readableTextWidthClass)}>
              外側ほど好成績です。各指標のバランスを示し、総合的な強さの順位づけはしません。
            </p>
          </ContentWithActions>
          {radar.sample.quality === "insufficient" || radar.sample.quality === "reference" ? (
            <p className={cn(contentText.body, readableTextWidthClass)}>
              {radar.sample.quality === "insufficient"
                ? "点数は3試合から表示します。現在は元の成績のみ確認できます。"
                : "40試合未満または8開催未満のため参考値です。採点した点は白抜きと破線で示します。"}
            </p>
          ) : null}
          {radar.basis ? null : (
            <p className={cn(contentText.body, readableTextWidthClass)}>
              採点基準が未適用のため、元の成績のみ表示しています。
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {players.map((player) => (
            <PlayerRadarChart key={player.memberId} player={player} tableId={tableId} />
          ))}
        </div>
        <div className="grid min-w-0 scroll-mt-4 gap-2" id={tableId}>
          <p className={contentText.supporting}>各欄の上段は点数、下段は元の成績です。</p>
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
        </div>
        <Disclosure
          ariaLabel="レーダーの読み方と採点基準"
          summary={
            <span className="inline-flex items-center gap-2">
              <BookOpenText aria-hidden="true" className="size-4" />
              読み方と採点基準
            </span>
          }
          panelSpacing="md"
          panelPadding="sm"
          triggerVariant="supporting"
        >
          <div className="grid gap-6">
            <FactList
              ariaLabel="6つの観点の意味"
              columns={2}
              items={playerRadarAxes.map((axis) => ({
                id: axis.id,
                label: axis.label,
                value: axis.description,
              }))}
            />
            <div className={readableTextWidthClass}>
              <FactList
                ariaLabel="レーダーの比べ方"
                items={[
                  {
                    id: "comparison",
                    label: "比べる範囲",
                    value:
                      "順位1軸・物件収益2軸・総資産3軸には関連があり、6つの独立した能力ではありません。異なる軸の1点差は、同じ成績差を意味しません。",
                  },
                  {
                    id: "quantiles",
                    label: "低め・中央・高めの値",
                    value:
                      "P10・中央値・P90は、小さい順に並べた値の位置の間を補間します。その範囲の平均ではありません。少数の試合では、低め・高めの値は最低額・最高額に近づきます。",
                  },
                  {
                    id: "values",
                    label: "元の成績",
                    value: "0円・負の総資産も成績に含めます。同点でも元の成績には差があります。",
                  },
                ]}
              />
            </div>
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
            {radar.basis ? (
              <>
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
                  同じ作品ではシーズン・マップを絞っても同じ基準で採点します。
                  マップの構成も成績に影響するため、点数の変化だけで上達とは断定できません。作品間の同点は同じ強さを意味しません。
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
                <p className={cn(contentText.supporting, readableTextWidthClass)}>
                  どの境界にも届かない場合は1点、境界と同じ値なら高い側の点数です。
                  「約」は表示用に丸めた境界です。採点には丸める前の値を使います。
                  基準作成時点の記録を20試合ずつ1試合刻みで集計し、分布の中央と広がりから境界を作ります。
                </p>
              </>
            ) : null}
          </div>
        </Disclosure>
      </div>
    </AnalysisSection>
  );
}
