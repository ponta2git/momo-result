import { useState } from "react";

import { ExpectedRankGapLegend } from "@/features/seriesComparison/charts/ExpectedRankGapTrack";
import {
  backgroundValueUnit,
  formatBackgroundValue,
  formatGapRank,
  gapAxis,
  gapItemLabel,
  gapLayerLabel,
  gapLevelLabel,
  gapVariableLabel,
  isReportedSignal,
} from "@/features/seriesComparison/model/expectedRankGapPresentation";
import type {
  ExpectedRankGap,
  ExpectedRankGapItem,
  GapAxis,
} from "@/features/seriesComparison/model/expectedRankGapPresentation";
import { playerName } from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/model/seriesAnalysisViewTypes";
import {
  GapGroupRow,
  GapRow,
  GapRowGroup,
  GapTable,
} from "@/features/seriesComparison/page/ExpectedRankGapTable";
import {
  AnalysisReadingGuide,
  AnalysisSection,
  AnalysisSubsection,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

const OVERALL = "overall";

export function ExpectedRankGapSection({
  onDrilldown,
  response,
}: {
  onDrilldown: (selection: SeriesAnalysisDrilldownSelection) => void;
  response: SeriesComparisonAggregate;
}) {
  const gap = response.expectedRankGap;
  return (
    <AnalysisSection
      id="metric-expected-rank-gap"
      meta={<ExpectedRankGapMeta gap={gap} />}
      title="見込みとの差"
    >
      {gap.status === "no_target" ? null : (
        <ExpectedRankGapBody gap={gap} response={response} onDrilldown={onDrilldown} />
      )}
    </AnalysisSection>
  );
}

function ExpectedRankGapMeta({ gap }: { gap: ExpectedRankGap }) {
  if (gap.status === "ok") {
    return gap.hasMergedLayers ? (
      <span className={contentText.supporting}>件数の少ない見込みの層を併合</span>
    ) : null;
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <SeriesAnalysisQualityAdvisory status={gap.status} />
      <span className={contentText.supporting}>
        {gap.status === "reference" ? "20戦未満のため判定なし" : "3戦未満のため見込みなし"}
      </span>
    </span>
  );
}

function ExpectedRankGapBody({
  gap,
  onDrilldown,
  response,
}: {
  gap: ExpectedRankGap;
  onDrilldown: (selection: SeriesAnalysisDrilldownSelection) => void;
  response: SeriesComparisonAggregate;
}) {
  const axis = gapAxis(gap);
  const judged = gap.status === "ok";
  return (
    <div className="grid gap-6">
      <p className={cn(contentText.body, readableTextWidthClass)}>
        物件収益の順位と目的地の回数が同じ試合の平均順位を見込みとし、実際の順位と比べます。
      </p>
      <AnalysisSubsection id="metric-expected-rank-gap-players" title="4人の差">
        <div className="grid gap-2">
          <GapTable
            axis={axis}
            caption="4人の見込みとの差"
            countHeader="対象"
            labelHeader="プレーヤー"
          >
            <GapRowGroup>
              {gap.players.map((player) => {
                const name = playerName(response.players, player.memberId);
                return (
                  <GapRow
                    axis={axis}
                    countUnit="戦"
                    judgementAction={
                      <Button
                        aria-label={`${name}の根拠の試合を見る`}
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          onDrilldown({
                            memberId: player.memberId,
                            metricId: "expectedRankGap.evidence",
                          })
                        }
                      >
                        根拠の試合
                      </Button>
                    }
                    key={player.memberId}
                    label={
                      <MemberSequenceLabel memberId={player.memberId}>{name}</MemberSequenceLabel>
                    }
                    showShare={false}
                    summary={player}
                  />
                );
              })}
            </GapRowGroup>
          </GapTable>
          <ExpectedRankGapLegend band={judged} marker={false} />
        </div>
      </AnalysisSubsection>
      <ItemGapSubsection axis={axis} gap={gap} response={response} />
      <AnalysisReadingGuide
        ariaLabel="見込みとの差の読み方"
        items={readingItems(gap.permutationCount)}
      >
        <LayerTable gap={gap} />
      </AnalysisReadingGuide>
    </div>
  );
}

function ItemGapSubsection({
  axis,
  gap,
  response,
}: {
  axis: GapAxis;
  gap: ExpectedRankGap;
  response: SeriesComparisonAggregate;
}) {
  const [requestedSubject, setSubject] = useState(OVERALL);
  const subjectIndex = gap.players.findIndex((player) => player.memberId === requestedSubject);
  const overall = subjectIndex < 0;
  const judged = gap.status === "ok";
  return (
    <AnalysisSubsection id="metric-expected-rank-gap-items" title="記録別の差">
      <div className="grid gap-3">
        <SegmentedControl
          label="記録別の差の対象"
          options={[
            { value: OVERALL, label: "場全体" },
            ...gap.players.map((player) => ({
              value: player.memberId,
              label: playerName(response.players, player.memberId),
            })),
          ]}
          presentation="plain"
          value={overall ? OVERALL : requestedSubject}
          onValueChange={setSubject}
        />
        <GapTable
          axis={axis}
          caption={
            overall
              ? "記録別の見込みとの差（場全体）"
              : `記録別の見込みとの差（${playerName(response.players, requestedSubject)}）`
          }
          countHeader={overall ? "件数" : "戦数"}
          labelHeader="回数"
        >
          {gap.items.map((item) => (
            <ItemRowGroup
              axis={axis}
              item={item}
              judged={judged}
              key={item.item}
              subjectIndex={overall ? null : subjectIndex}
            />
          ))}
        </GapTable>
        <ExpectedRankGapLegend band={false} marker={judged && !overall} />
      </div>
    </AnalysisSubsection>
  );
}

function ItemRowGroup({
  axis,
  item,
  judged,
  subjectIndex,
}: {
  axis: GapAxis;
  item: ExpectedRankGapItem;
  judged: boolean;
  subjectIndex: number | null;
}) {
  const reported = item.levels.some((level) => isReportedSignal(level.overall.signal));
  const overall = subjectIndex === null;
  return (
    <GapRowGroup>
      <GapGroupRow heading>
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={contentText.heading}>{gapItemLabel(item.item)}</span>
          {item.conclusion && (overall || reported) ? (
            <span
              className={overall && reported ? contentText.compactPrimary : contentText.supporting}
            >
              {overall ? item.conclusion : `場全体: ${item.conclusion}`}
            </span>
          ) : null}
        </span>
      </GapGroupRow>
      {item.levels.map((level) => {
        const summary = overall ? level.overall : level.byPlayer[subjectIndex];
        if (!summary) return null;
        return (
          <GapRow
            axis={axis}
            countUnit={overall ? "件" : "戦"}
            groupLabel={gapItemLabel(item.item)}
            key={`${level.minimumCount}`}
            label={gapLevelLabel(level)}
            marker={overall || !judged ? null : level.overall.meanGap}
            summary={summary}
          />
        );
      })}
      {overall && item.background ? (
        <GapGroupRow>
          <BackgroundDisclosure item={item} />
        </GapGroupRow>
      ) : null}
    </GapRowGroup>
  );
}

function BackgroundDisclosure({ item }: { item: ExpectedRankGapItem }) {
  const background = item.background;
  if (!background) return null;
  const rows = background.rows.map((row) => {
    const level = item.levels[row.levelIndex];
    return { ...row, label: level ? gapLevelLabel(level) : "—" };
  });
  return (
    <Disclosure
      panelSpacing="sm"
      summary={`背景: ${background.summary}`}
      triggerVariant="supporting"
    >
      <DataTable
        caption={{ content: `${gapItemLabel(item.item)}の回数別に一緒に動く記録` }}
        columns={[
          {
            header: "回数",
            key: "level",
            renderCell: (row) => row.label,
            rowHeader: true,
          },
          ...background.variables.map((variable, index) => ({
            align: "right" as const,
            header: (
              <span className="grid">
                <span>{gapVariableLabel(variable)}</span>
                <span className={contentText.supporting}>{backgroundValueUnit(variable)}</span>
              </span>
            ),
            key: variable,
            renderCell: (row: (typeof rows)[number]) => {
              const value = row.values[index];
              if (!value) return "—";
              return (
                <span className="grid">
                  <span className={value.marked ? contentText.compactPrimary : ""}>
                    {formatBackgroundValue(variable, value.value)}
                  </span>
                  {value.marked ? <span className={contentText.supporting}>差あり</span> : null}
                </span>
              );
            },
            tabular: true,
          })),
        ]}
        density="compact"
        getRowKey={(row) => String(row.levelIndex)}
        minWidth="44rem"
        rows={rows}
      />
    </Disclosure>
  );
}

function LayerTable({ gap }: { gap: ExpectedRankGap }) {
  if (gap.layers.length === 0) return null;
  return (
    <div className="grid gap-2">
      <h4 className={contentText.heading}>この範囲の見込み順位</h4>
      {gap.hasMergedLayers ? (
        <p className={contentText.supporting}>
          件数の少ない層を、隣の目的地の区分と併合しています。
        </p>
      ) : null}
      <DataTable
        caption={{ content: "収益順位と目的地の回数ごとの見込み順位" }}
        columns={[
          {
            header: "層",
            key: "layer",
            renderCell: (layer) => gapLayerLabel(layer),
            rowHeader: true,
          },
          {
            align: "right",
            header: "件数",
            key: "count",
            renderCell: (layer) => `${layer.count}件`,
            tabular: true,
          },
          {
            align: "right",
            header: "見込み順位",
            key: "expected",
            renderCell: (layer) => formatGapRank(layer.expectedRank),
            tabular: true,
          },
        ]}
        density="compact"
        getRowKey={(layer) => `${layer.revenueRank}:${layer.destinationLevels.join("-")}`}
        rows={gap.layers}
      />
    </div>
  );
}

function readingItems(permutationCount: number) {
  return [
    {
      id: "expected",
      label: "見込み",
      value:
        "物件収益の順位と目的地の回数が同じだった試合結果（4人分）の平均順位です。総資産には物件と目的地の成果が含まれるため、この2つで決まる分を先に除いています。",
    },
    {
      id: "signal",
      label: "傾向あり・兆し",
      value:
        "「傾向あり」は偶然ではまず説明できず、対戦順の前半と後半で同じ向きだった差です。「兆し」は偶然にしては大きいものの、まだ言い切れない差です。帯の内側は、差がなくても偶然で動く範囲です。",
    },
    {
      id: "criteria",
      label: "判定の基準",
      value: `試合内で4人の結果を無作為に${permutationCount.toLocaleString("ja-JP")}回入れ替えた戦績と比べています。4人のうち誰か、または全区分のどれかに偶然で出る頻度が20回に1回未満なら傾向あり、10回に1回未満なら兆しです。20戦未満の範囲と1〜2件の区分は判定しません。`,
    },
    {
      id: "records",
      label: "記録別の差",
      value:
        "その回数だった試合の結果を並べたものです。回数は試合終了時の値で、止まった順序や理由は記録にありません。余裕のある展開だから回数が増えた可能性も消せません。",
    },
    {
      id: "background",
      label: "背景",
      value:
        "同じ収益順位・目的地回数の試合と比べて、一緒に動いていた値です。原因を示すものではなく、なぜその駅に止まったかは記録から分かりません。総資産は順位そのものに近いため、判定を付けていません。",
    },
    {
      id: "not-for",
      label: "使わない場面",
      value: "「見込みより上位」を強さやうまさとして読まず、次戦の結果の予測にも使いません。",
    },
  ];
}
