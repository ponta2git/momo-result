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
import { contentText } from "@/shared/ui/typography";

const tableId = "player-radar-values";

function RadarValue({ cell }: { cell: PlayerRadarCell | undefined }) {
  return (
    <div className="grid gap-1">
      <p className={contentText.compactPrimary}>
        {playerRadarScoreLabel(cell)}
        {cell?.sampleQuality === "reference" && cell.score !== null ? (
          <span className={cn(contentText.body, "ml-2")}>参考</span>
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
        <p className={cn(contentText.body, "text-pretty")}>
          外側ほど好成績です。順位・収益・資産それぞれの点数の揃い方を読みます。
          6つの独立した能力や総合的な強さを示す図ではありません。
        </p>
        <FactList
          ariaLabel="レーダーの対象と使用基準"
          columns={2}
          items={[
            {
              id: "sample",
              label: "表示対象",
              value: `${radar.sample.matchCount}試合・${radar.sample.heldEventCount}開催`,
            },
            {
              id: "basis",
              label: "使用基準（作品共通）",
              value: radar.basis
                ? `${radar.basis.createdAt ? `${formatDateOnly(radar.basis.createdAt)} 作成` : "作成日時未取得"}・${radar.basis.appliedAt ? `${formatDateOnly(radar.basis.appliedAt)} 適用` : "適用日時未取得"}`
                : "基準未作成・元の成績を表示",
            },
          ]}
        />
        {radar.sample.quality === "insufficient" || radar.sample.quality === "reference" ? (
          <p className={contentText.body}>
            {radar.sample.quality === "insufficient"
              ? "点数は3試合から表示します。現在は元の成績のみ確認できます。"
              : "40試合未満または8開催未満のため、対象記録は参考水準です。採点できる場合は、白抜きの点と破線で「参考」として示します。"}
            少数の試合では、高い側・低い側の値は最高額・最低額に近づきます。
          </p>
        ) : null}
        {radar.basis ? null : (
          <p className={contentText.body}>
            管理者が作品の採点基準を作成・適用すると点数を表示できます。元の成績は下の表で確認できます。
          </p>
        )}
        <ActionLink
          className="min-h-11 w-fit py-2 text-sm text-[var(--color-text-primary)] underline underline-offset-4"
          href={`#${tableId}`}
        >
          数値で比較する
        </ActionLink>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-x-4 gap-y-6">
          {players.map((player) => (
            <PlayerRadarChart key={player.memberId} player={player} tableId={tableId} />
          ))}
        </div>
        <div className="min-w-0 scroll-mt-4" id={tableId}>
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
            getRowKey={(axis) => axis.id}
            rows={[...playerRadarAxes]}
            stickyRowHeader
            verticalAlign="top"
          />
        </div>
        <Disclosure
          summary="指標の意味・対象記録・採点基準を確認する"
          panelSpacing="md"
          triggerLayout="flush-horizontal"
        >
          <div className="grid gap-5">
            <dl className="grid gap-3 sm:grid-cols-2">
              {playerRadarAxes.map((axis) => (
                <div key={axis.id}>
                  <dt className={contentText.heading}>{axis.label}</dt>
                  <dd className={cn(contentText.body, "mt-1 text-pretty")}>{axis.description}</dd>
                </div>
              ))}
            </dl>
            <p className={contentText.body}>
              P10・中央値・P90は、値を小さい順に並べて位置の間を補間します。その範囲の平均ではありません。
              表示用に丸めた数値ではなく、丸める前の値で採点しています。0円・負の資産も成績に含めます。
            </p>
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
                      id: "basis-id",
                      label: "基準ID",
                      value: radar.basis.basisId,
                    },
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
                    {
                      id: "method",
                      label: "指標・採点方法",
                      value: `${radar.basis.definitionVersion} / ${radar.basis.methodVersion}`,
                    },
                  ]}
                />
                <p className={contentText.body}>
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
                  getRowKey={(axis) => axis.id}
                  rows={[...playerRadarAxes]}
                  stickyRowHeader
                />
                <p className={contentText.supporting}>
                  どの境界にも届かない場合は1点、境界と同じ値なら高い側の点数です。
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
