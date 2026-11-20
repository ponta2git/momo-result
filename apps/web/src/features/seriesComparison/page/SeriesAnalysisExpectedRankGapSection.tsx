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

type GapSubjectProps = {
  memberId: string | undefined;
  onMemberChange: ((memberId: string | undefined) => void) | undefined;
  players: SeriesComparisonAggregate["players"];
};

export function ExpectedRankGapSection({
  gap,
  memberId,
  onDrilldown,
  onMemberChange,
  players,
}: GapSubjectProps & {
  gap: ExpectedRankGap;
  onDrilldown: (selection: SeriesAnalysisDrilldownSelection) => void;
}) {
  return (
    <AnalysisSection
      id="metric-expected-rank-gap"
      meta={<ExpectedRankGapMeta gap={gap} />}
      title="見込みとの差"
    >
      {gap.status === "no_target" ? null : (
        <ExpectedRankGapBody
          gap={gap}
          memberId={memberId}
          players={players}
          onMemberChange={onMemberChange}
          onDrilldown={onDrilldown}
        />
      )}
    </AnalysisSection>
  );
}

function ExpectedRankGapMeta({ gap }: { gap: ExpectedRankGap }) {
  if (gap.status === "ok") {
    return gap.hasMergedLayers ? (
      <span className={contentText.supporting}>一部の見込みは目的地の回数をまとめて算出</span>
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
  memberId,
  onDrilldown,
  onMemberChange,
  players,
}: GapSubjectProps & {
  gap: ExpectedRankGap;
  onDrilldown: (selection: SeriesAnalysisDrilldownSelection) => void;
}) {
  const axis = gapAxis(gap);
  const judged = gap.status === "ok";
  return (
    <div className="grid gap-6">
      <p className={cn(contentText.body, readableTextWidthClass)}>
        物件収益の順位と目的地の回数が同じだった結果の平均順位を見込みとし、この2つでは説明できない順位の差を示します。
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
                const name = playerName(players, player.memberId);
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
      <ItemGapSubsection
        axis={axis}
        gap={gap}
        memberId={memberId}
        players={players}
        onMemberChange={onMemberChange}
      />
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
  memberId,
  onMemberChange,
  players,
}: GapSubjectProps & {
  axis: GapAxis;
  gap: ExpectedRankGap;
}) {
  const subject = gap.players.find((player) => player.memberId === memberId);
  const overall = subject === undefined;
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
              label: playerName(players, player.memberId),
            })),
          ]}
          presentation="plain"
          value={subject?.memberId ?? OVERALL}
          onValueChange={(value) => onMemberChange?.(value === OVERALL ? undefined : value)}
        />
        <GapTable
          axis={axis}
          caption={
            overall
              ? "記録別の見込みとの差（場全体）"
              : `記録別の見込みとの差（${playerName(players, subject.memberId)}）`
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
              memberId={subject?.memberId}
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
  memberId,
}: {
  axis: GapAxis;
  item: ExpectedRankGapItem;
  judged: boolean;
  memberId: string | undefined;
}) {
  const reported = item.levels.some((level) => isReportedSignal(level.overall.signal));
  const overall = memberId === undefined;
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
        const summary = overall
          ? level.overall
          : level.byPlayer.find((player) => player.memberId === memberId);
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

/**
 * What the reader cannot see from the table itself: what the gap contains, how the bar, band and
 * words relate, how the rows add up, and where the records stop explaining. Facts already shown
 * by the intro, legend, or quality notices are not repeated here.
 */
function readingItems(permutationCount: number) {
  return [
    {
      id: "gap",
      label: "見込みとの差",
      value:
        "見込みは試合前の予想ではなく、試合後の記録から作る比較の基準です。差には駅やカードの記録の分だけでなく、記録にない出来事や運の分も残るため、強さやうまさの差とは限りません。4人の差は合わせると0になり、誰かの＋はほかの誰かの−です。",
    },
    {
      id: "signal",
      label: "傾向あり・兆し",
      value:
        "棒が帯の外まで伸びた差に付きます。傾向ありは、そのうち偶然ではまず出ない大きさで、対戦順の前半と後半でも同じ向きだった差です。この範囲の結論として読めます。兆しはまだ言い切れない差で、試合が増えても同じ向きが続くかを見ます。帯は件数の少ない区分ほど広く、同じ大きさの差でも件数が少ないと言葉は付きにくくなります。",
    },
    {
      id: "records",
      label: "記録別の差",
      value:
        "場全体の区分の差は、件数の重みを付けて合わせると0になります。ある区分が見込みより上位なら残りの区分は下位に寄るため、区分の並び全体で読みます。プレーヤーを選ぶと、4人の差に出た本人の差がどの区分に表れているかを、場全体の目印と比べて読めます。",
    },
    {
      id: "counts",
      label: "記録の回数",
      value:
        "回数は試合終了時の合計で、いつ・なぜ止まったか（狙ったのか出目か）は記録にありません。カード売り場が多くて上位だった試合も、売り場で上位になったのか、余裕があって売り場に寄れたのかは区別できません。経緯は根拠の試合の試合メモで確かめます。",
    },
    {
      id: "background",
      label: "背景",
      value:
        "記録どうしは差し引き合っていないため、ある記録の差には一緒に起きやすいほかの記録の分も含まれます。背景は、その回数だった試合のほかの記録と物件収益のシェアを、同じ収益順位・目的地回数の結果と比べた差です。見込みは収益の順位しか使わないため、シェアに差ありが付いた区分は、順位に表れない収益の大きさの違いと重なった差です。総資産は順位そのものに近いため判定しません。",
    },
    {
      id: "criteria",
      label: "判定の基準",
      value: `同じ試合の中で4人の見込みとの差をくじで入れ替え、記録と差が結び付かない戦績を${permutationCount.toLocaleString("ja-JP")}通り作って比べています。4人の差は4人の誰かに、記録別の差は全記録・全区分のどこかに、その大きさの差が偶然出る割合が20回に1回未満なら傾向あり、10回に1回未満なら兆しです。まとめて数えるため、行を一つずつ見るより厳しく判定します。`,
    },
  ];
}
