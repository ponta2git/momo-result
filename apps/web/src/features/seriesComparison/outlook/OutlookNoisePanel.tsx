import { useMemo, useState } from "react";

import {
  buildJointDistribution,
  generateOutlookExamples,
  jointFromCounts,
} from "@/features/seriesComparison/model/outlook";
import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import { OutlookChart } from "@/features/seriesComparison/outlook/OutlookChart";
import { OutlookHorizonControl } from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { canonicalResultMemberIds } from "@/shared/domain/members";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { contentText } from "@/shared/ui/typography";

export function OutlookNoisePanel({
  active,
  response,
  cumulative,
  session,
  names,
  memberIds,
}: {
  active: boolean;
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  session: OutlookSession;
  names: readonly [string, string];
  memberIds: readonly [string, string];
}) {
  const [selected, setSelected] = useState("0");
  const [inspection, setInspection] = useState({ horizon: 20, horizonText: "20" });
  const selectHorizon = (next: typeof inspection) => {
    const horizon = Math.max(1, Math.min(100, next.horizon));
    setInspection({
      horizon,
      horizonText: horizon === next.horizon ? next.horizonText : String(horizon),
    });
  };
  const entries = session.gesture?.before ?? session.entries;
  const focus = entries[0].distribution;
  const rival = entries[1].distribution;
  const examples = useMemo(() => {
    if (!active) return undefined;
    const record = response.recent.jointRanks.find(
      (pair) => memberIds.includes(pair.memberAId) && memberIds.includes(pair.memberBId),
    );
    if (!record) return null;
    const canonicalIds = canonicalResultMemberIds.filter((id) => memberIds.includes(id)) as [
      string,
      string,
    ];
    const focusFirst = canonicalIds[0] === memberIds[0];
    const observed =
      record.memberAId === canonicalIds[0]
        ? record.rankCounts
        : [0, 1, 2, 3].map((column) =>
            record.rankCounts.map((row) => {
              const value = row[column];
              if (value === undefined) throw new Error("Incomplete joint ranks");
              return value;
            }),
          );
    const joint = buildJointDistribution(
      focusFirst ? focus : rival,
      focusFirst ? rival : focus,
      jointFromCounts(observed),
    );
    return joint
      ? generateOutlookExamples({
          gameTitleId: response.artifact.gameTitleId,
          canonicalMemberIds: canonicalIds,
          focusMemberId: memberIds[0],
          cumulative,
          joint,
        })
      : null;
  }, [active, response, memberIds, focus, rival, cumulative]);
  const example = examples?.examples[Number(selected)];
  if (!active) return null;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4" aria-busy={Boolean(session.gesture)}>
      <p className={contentText.supporting}>
        同じ成績から作った3つの展開例です。確率や上下限を示すものではありません。
      </p>
      {examples ? (
        <>
          <SelectField
            label="表示する展開例"
            value={selected}
            onValueChange={setSelected}
            options={examples.examples.map((_, index) => ({
              value: String(index),
              label: `展開例${index + 1}`,
            }))}
          />
          {examples.constantPerGameDifference ? (
            <p className={contentText.body}>
              この内訳では、どの展開例も2人の差は同じ推移になります。
            </p>
          ) : examples.distinctCandidateCount < 3 ? (
            <p className={contentText.body}>2人の差が同じ推移になる展開例を含みます。</p>
          ) : null}
          {example ? (
            <OutlookChart
              cumulative={cumulative}
              distributions={[focus, rival]}
              names={names}
              memberIds={memberIds}
              {...inspection}
              range={100}
              maxHorizon={100}
              marker={null}
              examplePoints={example.points}
              onHorizonChange={selectHorizon}
              horizonControl={
                <OutlookHorizonControl {...inspection} max={100} onChange={selectHorizon} />
              }
            />
          ) : null}
        </>
      ) : (
        <p className={contentText.body}>
          この条件の展開例を表示できません。「平均の推移」で見通しを確認できます。
        </p>
      )}
    </div>
  );
}
